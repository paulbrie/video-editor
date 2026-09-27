import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, frames, projects, videos } from "@/db";
import { EditorApp } from "@/components/editor/editor-app";
import { isUuid } from "@/lib/ids";

async function getProject(id: string) {
  if (!isUuid(id)) return null;
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  return project ?? null;
}

export async function generateMetadata(props: PageProps<"/p/[id]">): Promise<Metadata> {
  const project = await getProject((await props.params).id);
  return { title: project ? `${project.name} · Cutroom` : "Project not found · Cutroom" };
}

/** One project per URL, so several can be open in separate tabs. */
export default async function ProjectPage(props: PageProps<"/p/[id]">) {
  await connection(); // always render at request time: data lives in the database
  const project = await getProject((await props.params).id);
  if (!project) notFound();

  const [library, stills] = await Promise.all([
    db
      .select()
      .from(videos)
      .where(and(eq(videos.projectId, project.id), eq(videos.status, "ready")))
      .orderBy(videos.createdAt),
    db.select().from(frames).where(eq(frames.projectId, project.id)).orderBy(desc(frames.createdAt)),
  ]);
  return <EditorApp key={project.id} videos={library} project={project} frames={stills} />;
}
