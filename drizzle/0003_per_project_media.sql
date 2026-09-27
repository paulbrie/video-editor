-- Media and frames now belong to one project.
ALTER TABLE "videos" ADD COLUMN "project_id" uuid;--> statement-breakpoint
-- Backfill: the most recently edited project whose timeline uses the file, else the oldest project.
UPDATE "videos" v SET "project_id" = COALESCE(
  (SELECT p."id" FROM "projects" p
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p."timeline"->'segs') s WHERE s->>'src' = v."id"::text)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p."timeline"->'audio', '[]'::jsonb)) a WHERE a->>'src' = v."id"::text)
    ORDER BY p."updated_at" DESC LIMIT 1),
  (SELECT "id" FROM "projects" ORDER BY "created_at" LIMIT 1)
);--> statement-breakpoint
-- Only possible when media exists but no project does: nothing can own it.
DELETE FROM "videos" WHERE "project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "videos" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "frames" f SET "project_id" = (SELECT v."project_id" FROM "videos" v WHERE v."id" = f."video_id") WHERE f."project_id" IS NULL;--> statement-breakpoint
DELETE FROM "frames" WHERE "project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "frames" DROP CONSTRAINT "frames_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "frames" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "frames" ADD CONSTRAINT "frames_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
