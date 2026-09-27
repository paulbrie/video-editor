CREATE TYPE "public"."video_status" AS ENUM('uploading', 'ready');--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'Untitled project' NOT NULL,
	"timeline" jsonb DEFAULT '{"segs":[],"markIn":null,"markOut":null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" bigint NOT NULL,
	"duration" double precision NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"fps" double precision DEFAULT 30 NOT NULL,
	"thumbnail" text,
	"storage_key" text NOT NULL,
	"status" "video_status" DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
