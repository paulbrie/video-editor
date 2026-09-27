import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, frames } from "@/db";
import { isUuid, notFound } from "@/lib/ids";
import { FRAMES_DIR, storagePath } from "@/lib/storage";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/frames/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const [row] = await db.delete(frames).where(eq(frames.id, id)).returning();
  if (!row) return notFound();
  await rm(storagePath(row.storageKey, FRAMES_DIR), { force: true });
  return new Response(null, { status: 204 });
}
