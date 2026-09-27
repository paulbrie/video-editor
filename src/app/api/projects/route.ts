import { desc } from "drizzle-orm";
import { db, projects } from "@/db";

export async function GET() {
  const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt));
  return Response.json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      clips: p.timeline.segs.length,
      duration: p.timeline.segs.reduce((a, s) => a + (s.out - s.in), 0),
    })),
  );
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = typeof b?.name === "string" && b.name.trim() ? b.name.trim().slice(0, 200) : "Untitled project";
  const [row] = await db.insert(projects).values({ name }).returning();
  return Response.json(row, { status: 201 });
}
