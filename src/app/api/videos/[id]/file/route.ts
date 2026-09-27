import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { eq } from "drizzle-orm";
import { db, videos } from "@/db";
import { ensureStorageDir, storagePath } from "@/lib/storage";
import { isUuid, notFound } from "@/lib/ids";

/** Receives the raw file bytes as the request body and streams them to disk. */
export async function PUT(req: Request, ctx: RouteContext<"/api/videos/[id]/file">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  if (!video) return Response.json({ error: "Not found" }, { status: 404 });
  if (video.status === "ready") return Response.json({ error: "Already uploaded" }, { status: 409 });
  if (!req.body) return Response.json({ error: "Empty body" }, { status: 400 });

  await ensureStorageDir();
  const final = storagePath(video.storageKey);
  const part = final + ".part";
  try {
    await pipeline(Readable.fromWeb(req.body as NodeWebReadableStream), createWriteStream(part));
    const { size } = await stat(part);
    if (size !== video.size) throw new Error(`Expected ${video.size} bytes, received ${size}`);
    await rename(part, final);
  } catch (e) {
    await rm(part, { force: true });
    return Response.json({ error: "Upload failed: " + (e as Error).message }, { status: 400 });
  }
  const [row] = await db.update(videos).set({ status: "ready" }).where(eq(videos.id, id)).returning();
  return Response.json(row);
}

/** Streams the file with HTTP Range support, which the <video> element needs for seeking. */
export async function GET(req: Request, ctx: RouteContext<"/api/videos/[id]/file">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  if (!video || video.status !== "ready") return new Response("Not found", { status: 404 });

  const file = storagePath(video.storageKey);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response("File missing on disk", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": video.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  });

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (!m[1] && !m[2])) return rangeNotSatisfiable(size);
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(m[2])); // suffix range: last N bytes
    }
    if (start > end || start >= size) return rangeNotSatisfiable(size);
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(end - start + 1));

  const stream = createReadStream(file, { start, end });
  req.signal.addEventListener("abort", () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}

function rangeNotSatisfiable(size: number) {
  return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
}
