import { writeFile } from "node:fs/promises";
import { desc, eq } from "drizzle-orm";
import { db, frames, videos } from "@/db";
import { isUuid } from "@/lib/ids";
import { FRAMES_DIR, ensureStorageDir, storagePath } from "@/lib/storage";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_BYTES = 100 * 1024 * 1024;
const num = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** `?projectId=` lists one project's frames. */
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId || !isUuid(projectId)) return Response.json({ error: "projectId is required" }, { status: 400 });
  const rows = await db.select().from(frames).where(eq(frames.projectId, projectId)).orderBy(desc(frames.createdAt));
  return Response.json(rows);
}

/** multipart/form-data: `image` (PNG) + `meta` (JSON: videoId, frameNumber, time, thumbnail). The frame joins the video's project. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const image = form?.get("image");
  const meta = (() => {
    try {
      return JSON.parse(String(form?.get("meta")));
    } catch {
      return null;
    }
  })();
  if (!(image instanceof Blob) || image.size === 0 || image.size > MAX_BYTES) {
    return Response.json({ error: "Missing or oversized image" }, { status: 400 });
  }
  if (
    !meta ||
    typeof meta.videoId !== "string" || !isUuid(meta.videoId) ||
    !num(meta.frameNumber, 0, 1e9) || !num(meta.time, 0, 1e7) ||
    typeof meta.thumbnail !== "string" || !meta.thumbnail.startsWith("data:image/") || meta.thumbnail.length > 500_000
  ) {
    return Response.json({ error: "Invalid frame metadata" }, { status: 400 });
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return Response.json({ error: "Image must be a PNG" }, { status: 400 });
  // PNG IHDR: width and height are big-endian uint32 at byte 16 and 20
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  const [video] = await db
    .select({ name: videos.name, projectId: videos.projectId })
    .from(videos)
    .where(eq(videos.id, meta.videoId));
  if (!video) return Response.json({ error: "Unknown video" }, { status: 404 });

  const id = crypto.randomUUID();
  const storageKey = `${id}.png`;
  await ensureStorageDir(FRAMES_DIR);
  await writeFile(storagePath(storageKey, FRAMES_DIR), bytes);

  const [row] = await db
    .insert(frames)
    .values({
      id,
      videoId: meta.videoId,
      projectId: video.projectId,
      videoName: video.name,
      frameNumber: Math.round(meta.frameNumber),
      time: meta.time,
      width,
      height,
      size: bytes.length,
      thumbnail: meta.thumbnail,
      storageKey,
    })
    .returning();
  return Response.json(row, { status: 201 });
}
