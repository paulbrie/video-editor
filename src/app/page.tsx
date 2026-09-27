import { connection } from "next/server";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db, projects } from "@/db";

/** `/` opens the most recently edited project (creating one on first run). */
export default async function Home() {
  await connection();
  const [latest] = await db.select({ id: projects.id }).from(projects).orderBy(desc(projects.updatedAt)).limit(1);
  const id = latest?.id ?? (await db.insert(projects).values({ name: "My first edit" }).returning())[0].id;
  redirect(`/p/${id}`);
}
