import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, frames } from "@/db";
import { isUuid, notFound } from "@/lib/ids";
import { FRAMES_DIR, storagePath } from "@/lib/storage";
import { frameFileName } from "@/lib/editor/format";

/** The PNG. `?download=1` makes the browser save it under a readable name. */
export async function GET(req: Request, ctx: RouteContext<"/api/frames/[id]/image">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const [row] = await db.select().from(frames).where(eq(frames.id, id));
  if (!row) return notFound();
  let bytes: Buffer;
  try {
    bytes = await readFile(storagePath(row.storageKey, FRAMES_DIR));
  } catch {
    return new Response("File missing on disk", { status: 404 });
  }
  const headers = new Headers({
    "Content-Type": "image/png",
    "Content-Length": String(bytes.length),
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  if (new URL(req.url).searchParams.has("download")) {
    const name = frameFileName(row.videoName, row.frameNumber);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  return new Response(new Uint8Array(bytes), { headers });
}
