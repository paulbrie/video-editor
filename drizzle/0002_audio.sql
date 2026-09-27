CREATE TYPE "public"."media_kind" AS ENUM('video', 'audio');--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "kind" "media_kind" DEFAULT 'video' NOT NULL;