import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, projects, videos } from "@/db";
import { storagePath } from "@/lib/storage";
import { isUuid, notFound } from "@/lib/ids";

export async function PATCH(req: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const b = await req.json().catch(() => null);
  const set: { fps?: number; name?: string; deletedAt?: Date | null } = {};
  if (b?.trashed !== undefined) {
    if (typeof b.trashed !== "boolean") return Response.json({ error: "trashed must be true or false" }, { status: 400 });
    set.deletedAt = b.trashed ? new Date() : null;
  }
  if (b?.fps !== undefined) {
    if (typeof b.fps !== "number" || !(b.fps >= 1 && b.fps <= 1000))
      return Response.json({ error: "fps must be a number between 1 and 1000" }, { status: 400 });
    set.fps = b.fps;
  }
  if (b?.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) return Response.json({ error: "Name can't be empty" }, { status: 400 });
    set.name = b.name.trim().slice(0, 500);
  }
  if (!Object.keys(set).length) return Response.json({ error: "Nothing to update (fps, name or trashed)" }, { status: 400 });
  const [row] = await db.update(videos).set(set).where(eq(videos.id, id)).returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

/**
 * Moves the file to the project's Trash (soft delete; the file stays on disk).
 * `?permanent=1` deletes the file, the row, and every clip or trash entry that used it.
 */
export async function DELETE(req: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  if (!new URL(req.url).searchParams.has("permanent")) {
    const [row] = await db.update(videos).set({ deletedAt: new Date() }).where(eq(videos.id, id)).returning();
    return row ? Response.json(row) : notFound();
  }
  const [row] = await db.delete(videos).where(eq(videos.id, id)).returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  await rm(storagePath(row.storageKey), { force: true });
  await rm(storagePath(row.storageKey) + ".part", { force: true });

  const all = await db.select().from(projects);
  for (const p of all) {
    const segs = p.timeline.segs.filter((s) => s.src !== id);
    const audio = (p.timeline.audio ?? []).filter((c) => c.src !== id);
    const trash = (p.timeline.trash ?? []).filter((i) => i.clip.src !== id);
    if (
      segs.length !== p.timeline.segs.length ||
      audio.length !== (p.timeline.audio ?? []).length ||
      trash.length !== (p.timeline.trash ?? []).length
    ) {
      await db.update(projects).set({ timeline: { ...p.timeline, segs, audio, trash } }).where(eq(projects.id, p.id));
    }
  }
  return new Response(null, { status: 204 });
}
