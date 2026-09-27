import { and, desc, eq, isNull } from "drizzle-orm";
import { db, projects, videos } from "@/db";
import { extensionFor } from "@/lib/storage";
import { isUuid } from "@/lib/ids";

const num = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** `?projectId=` lists one project's media. */
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId || !isUuid(projectId)) return Response.json({ error: "projectId is required" }, { status: 400 });
  const rows = await db
    .select()
    .from(videos)
    .where(and(eq(videos.projectId, projectId), eq(videos.status, "ready"), isNull(videos.deletedAt)))
    .orderBy(desc(videos.createdAt));
  return Response.json(rows);
}

/** Registers a video (metadata probed in the browser). The bytes follow via PUT /api/videos/:id/file. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const kind = b?.kind === "audio" ? "audio" : "video";
  const minSide = kind === "audio" ? 0 : 1; // audio files have no picture
  if (
    !b ||
    typeof b.id !== "string" || !isUuid(b.id) ||
    typeof b.projectId !== "string" || !isUuid(b.projectId) ||
    typeof b.name !== "string" || !b.name || b.name.length > 500 ||
    typeof b.mimeType !== "string" ||
    !num(b.size, 1, Number.MAX_SAFE_INTEGER) ||
    !num(b.duration, 0.001, 1e7) ||
    !num(b.width, minSide, 20000) || !num(b.height, minSide, 20000) ||
    !num(b.fps, 1, 1000) ||
    (b.thumbnail != null && (typeof b.thumbnail !== "string" || !b.thumbnail.startsWith("data:image/") || b.thumbnail.length > 500_000))
  ) {
    return Response.json({ error: "Invalid video metadata" }, { status: 400 });
  }
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, b.projectId));
  if (!project) return Response.json({ error: "Unknown project" }, { status: 404 });
  const [row] = await db
    .insert(videos)
    .values({
      id: b.id,
      projectId: project.id,
      kind,
      name: b.name,
      mimeType: b.mimeType || "application/octet-stream",
      size: b.size,
      duration: b.duration,
      width: Math.round(b.width),
      height: Math.round(b.height),
      fps: b.fps,
      thumbnail: b.thumbnail ?? null,
      storageKey: b.id + extensionFor(b.name, b.mimeType),
      status: "uploading",
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return Response.json({ error: "Video already exists" }, { status: 409 });
  return Response.json(row, { status: 201 });
}
