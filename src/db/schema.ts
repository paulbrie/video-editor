import {
  bigint,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const videoStatus = pgEnum("video_status", ["uploading", "ready"]);
export const mediaKind = pgEnum("media_kind", ["video", "audio"]);

/** Every uploaded media file, owned by one project. Audio files are rows with kind = "audio" (width/height 0). */
export const videos = pgTable("videos", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: mediaKind("kind").notNull().default("video"),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  duration: doublePrecision("duration").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  fps: doublePrecision("fps").notNull().default(30),
  /** Small image data URL: a JPEG still for video, a PNG waveform for audio. */
  thumbnail: text("thumbnail"),
  /** File name inside STORAGE_DIR. */
  storageKey: text("storage_key").notNull(),
  status: videoStatus("status").notNull().default("uploading"),
  /** Set when the file is moved to the project's Trash (the file stays on disk until deleted for good). */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** How a video clip starts: a dissolve from the previous clip or a dip through black. */
export type Transition = { type: "dissolve" | "dip"; duration: number };
export type TimelineSeg = {
  id: string;
  src: string;
  in: number;
  out: number;
  /** Custom label; falls back to the media file's name. */
  name?: string;
  /** Transition into this clip (on the first clip: a fade in from black). */
  transition?: Transition;
};
/** An audio clip placed at an absolute time on an audio track. */
export type AudioClip = {
  id: string;
  src: string;
  track: number;
  /** Timeline position of the clip's first sample, in seconds. */
  start: number;
  in: number;
  out: number;
  /** Linear gain, 0..2 */
  volume: number;
  /** Custom label; falls back to the media file's name. */
  name?: string;
};
export type Timeline = {
  segs: TimelineSeg[];
  markIn: number | null;
  markOut: number | null;
  /** Optional so projects saved before audio tracks existed still load. */
  audio?: AudioClip[];
  /** Mute for the video clips' own sound (V1). */
  videoMuted?: boolean;
  /** Mute per audio track (A1, A2, …). */
  audioMuted?: boolean[];
  /** Fade to black over the last N seconds of the edit. */
  fadeOut?: number | null;
  /** Deleted clips, newest first, restorable from the Trash tab. */
  trash?: TrashItem[];
};
/** `media` is set when the clip went to the Trash along with its (trashed) media file. */
export type TrashItem =
  | { kind: "video"; clip: TimelineSeg; index: number; deletedAt: number; media?: string }
  | { kind: "audio"; clip: AudioClip; deletedAt: number; media?: string };

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().default("Untitled project"),
  /** Free-form notepad for the project (plain text). */
  notes: text("notes").notNull().default(""),
  timeline: jsonb("timeline")
    .$type<Timeline>()
    .notNull()
    .default({ segs: [], markIn: null, markOut: null }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A still exported from a clip. Kept if its video is deleted; removed with its project. */
export const frames = pgTable("frames", {
  id: uuid("id").primaryKey(),
  videoId: uuid("video_id").references(() => videos.id, { onDelete: "set null" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Copied so the frame stays labelled after its video is gone. */
  videoName: text("video_name").notNull(),
  frameNumber: integer("frame_number").notNull(),
  /** Position in the source video, in seconds. */
  time: doublePrecision("time").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  size: integer("size").notNull(),
  /** Small JPEG data URL for the grid. */
  thumbnail: text("thumbnail").notNull(),
  /** PNG file name inside FRAMES_DIR. */
  storageKey: text("storage_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Video = typeof videos.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Frame = typeof frames.$inferSelect;
