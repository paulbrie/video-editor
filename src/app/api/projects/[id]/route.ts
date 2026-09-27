import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, frames, projects, videos, type AudioClip, type Timeline, type TimelineSeg, type Transition, type TrashItem } from "@/db";
import { FRAMES_DIR, storagePath } from "@/lib/storage";
import { isUuid, notFound } from "@/lib/ids";

const MAX_NAME = 200;
const n = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
/** A clip's optional custom name: a non-empty string, or absent. */
const clipName = (v: unknown) => (typeof v === "string" && v.trim() ? { name: v.trim().slice(0, MAX_NAME) } : {});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validating untyped JSON
function parseSeg(s: any): TimelineSeg | null {
  if (!s || typeof s.id !== "string" || typeof s.src !== "string" || !n(s.in, 0, 1e7) || !n(s.out, 0, 1e7) || s.out <= s.in)
    return null;
  const t = s.transition;
  const transition =
    t && (t.type === "dissolve" || t.type === "dip") && n(t.duration, 0.04, 10)
      ? { transition: { type: t.type as Transition["type"], duration: t.duration } }
      : {};
  return { id: s.id, src: s.src, in: s.in, out: s.out, ...clipName(s.name), ...transition };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validating untyped JSON
function parseAudio(c: any): AudioClip | null {
  if (
    !c || typeof c.id !== "string" || typeof c.src !== "string" ||
    !Number.isInteger(c.track) || c.track < 0 || c.track > 7 ||
    !n(c.start, 0, 1e7) || !n(c.in, 0, 1e7) || !n(c.out, 0, 1e7) || c.out <= c.in || !n(c.volume, 0, 4)
  )
    return null;
  return { id: c.id, src: c.src, track: c.track, start: c.start, in: c.in, out: c.out, volume: c.volume, ...clipName(c.name) };
}
function parseList<T>(v: unknown, parse: (x: unknown) => T | null): T[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 10_000) return null;
  const out: T[] = [];
  for (const x of v) {
    const p = parse(x);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

function parseTimeline(t: unknown): Timeline | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown>;
  if (!Array.isArray(o.segs)) return null;
  const segs = parseList(o.segs, parseSeg);
  const audio = parseList(o.audio, parseAudio);
  const trash = parseList<TrashItem>(o.trash, (x) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validating untyped JSON
    const i = x as any;
    if (!i || !n(i.deletedAt, 0, 1e15)) return null;
    const media = typeof i.media === "string" && isUuid(i.media) ? { media: i.media as string } : {};
    if (i.kind === "video") {
      const clip = parseSeg(i.clip);
      return clip && Number.isInteger(i.index) && i.index >= 0
        ? { kind: "video", clip, index: i.index, deletedAt: i.deletedAt, ...media }
        : null;
    }
    const clip = i.kind === "audio" ? parseAudio(i.clip) : null;
    return clip && { kind: "audio", clip, deletedAt: i.deletedAt, ...media };
  });
  if (!segs || !audio || !trash) return null;
  const audioMuted = Array.isArray(o.audioMuted) ? o.audioMuted.slice(0, 8).map((m) => m === true) : [];
  const mark = (v: unknown) => (n(v, 0, 1e7) ? v : null);
  return {
    segs,
    markIn: mark(o.markIn),
    markOut: mark(o.markOut),
    audio,
    videoMuted: o.videoMuted === true,
    audioMuted,
    fadeOut: n(o.fadeOut, 0.04, 10) ? o.fadeOut : null,
    trash: trash.slice(0, 500),
  };
}

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const b = await req.json().catch(() => null);
  if (!b) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) return Response.json({ error: "Invalid name" }, { status: 400 });
    set.name = b.name.trim().slice(0, 200);
  }
  if (b.notes !== undefined) {
    if (typeof b.notes !== "string" || b.notes.length > 200_000)
      return Response.json({ error: "Notes must be text (up to 200,000 characters)" }, { status: 400 });
    set.notes = b.notes;
  }
  if (b.timeline !== undefined) {
    const t = parseTimeline(b.timeline);
    if (!t) return Response.json({ error: "Invalid timeline" }, { status: 400 });
    set.timeline = t;
  }
  const [row] = await db.update(projects).set(set).where(eq(projects.id, id)).returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

/** Deletes the project together with its media and frames (rows cascade; files are removed here). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const media = await db.select({ key: videos.storageKey }).from(videos).where(eq(videos.projectId, id));
  const stills = await db.select({ key: frames.storageKey }).from(frames).where(eq(frames.projectId, id));
  const [row] = await db.delete(projects).where(eq(projects.id, id)).returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  await Promise.all([
    ...media.flatMap((m) => [rm(storagePath(m.key), { force: true }), rm(storagePath(m.key) + ".part", { force: true })]),
    ...stills.map((f) => rm(storagePath(f.key, FRAMES_DIR), { force: true })),
  ]);
  return new Response(null, { status: 204 });
}
