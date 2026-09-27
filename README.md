# Cutroom

A browser video editor: play several videos back to back, cut and trim them frame by frame, lay music or voice-over on audio tracks, and export the result.

Stack: Next.js 16 (App Router) · shadcn/ui · [subjecto](https://github.com/paulbrie/subjecto) for editor state · Drizzle ORM · Postgres 17 in Docker.

## Run it

```bash
cp .env.example .env      # first time only
npm install
npm run setup             # starts Postgres (port 5442) and applies migrations
npm run dev               # http://localhost:3000
```

Add videos and audio files with **Add media** or by dropping them anywhere on the page. Press `?` in the app for all keyboard shortcuts.

Each project has its own URL (`/p/<id>`), media, frames and tracks: a new project starts empty, and deleting a project deletes its files too. `/` opens the most recently edited one. Open several projects in separate tabs (⌘-click in **Open project**). Two tabs editing the *same* project overwrite each other's saves,.

## How it's put together

| Piece | Where |
| --- | --- |
| DB schema (`projects`; `videos` — video and audio files — and `frames`, both owned by a project) | `src/db/schema.ts`, migrations in `drizzle/` |
| Upload / stream / delete videos | `src/app/api/videos/**` |
| Projects (autosaved timelines) | `src/app/api/projects/**` |
| Exported frames | `src/app/api/frames/**` |
| Editor engine (playback, frame stepping, edits, export) | `src/lib/editor/engine.ts` |
| Project page (one per URL) | `src/app/p/[id]/page.tsx` |
| UI | `src/components/editor/*` |
| Original single-file version | `legacy/index.html` |

- **Video files** are stored on disk in `STORAGE_DIR` (default `./storage/videos`, git-ignored). Postgres holds their metadata (duration, size, fps, thumbnail) and the project timelines.
- **Adding a video**: the browser reads the file locally (duration, frame rate, thumbnail) and puts it on the timeline straight away. It then registers the file (`POST /api/videos`) and streams the bytes (`PUT /api/videos/:id/file`) with a progress bar in the library. Large files are streamed to disk, not held in memory.
- **Playback** uses `GET /api/videos/:id/file`, which supports HTTP Range requests so seeking works.
- **State** lives in subjecto `Subject`s on the `Editor` class (`sources$`, `edit$`, `view$`, `play$`, `project$`, …). Components read them with `useSubject` from `subjecto/react`.
- **Audio tracks**: audio files go on tracks A1/A2 at the playhead, at absolute times (reordering video doesn't move them). Drag them in time or between tracks, drag their edges to trim, set a per-clip volume, and mute V1 (the videos' own sound) or any audio track. Cut/Keep range apply to every track. The edit ends where the video ends. Playback routes every element through a Web Audio graph (element → gain → mix → master), and export records `mix`, so what you hear is what you export.
- **Right-click** a timeline clip for Rename (also `F2`), Use file name, Split here, Duplicate and Delete; right-click a media item to rename the file, add it, or delete it. A clip's custom name is stored in the timeline (`name`); clips without one show their file's name.
- **Trash**: deleting a timeline clip (`⌫`, or right-click → Move to Trash) moves it to the sidebar's Trash tab (stored in the timeline JSON as `trash`). From there: put it back where it was, insert it at the playhead, or delete it forever. Deleting a media file is a soft delete too (`videos.deleted_at`): the file stays on disk, its clips go to the Trash with it (`media` on the trash entry), and restoring the file puts them back. Only **Delete forever** / **Empty trash** (both confirmed) or deleting the whole project remove files from disk.
- **Transitions**: the ◇ on each cut picks a cross-dissolve or a dip to black (`T` toggles a dissolve at the nearest cut); the ◇ at either end fades in from / out to black. A transition belongs to the clip it leads into (`transition` on the seg; the edit-level `fadeOut`). Dissolves are centred on the cut and use the source's frames beyond the in/out points (held if the file has none). The preview is composited onto a canvas every frame with the same code the export and frame capture use, and the clips' own sound fades with the picture.
- **Notes**: each project has a notepad (`notes` column), opened from the header or with `N`; “Insert timecode” stamps the playhead position.
- **Projects** autosave about 1 s after each edit. `⌘S` or **Save project** saves immediately.
- **Export** is done in the browser (canvas + MediaRecorder, in real time) and downloads an MP4 or WebM.
- **Export frame** (`E`, or **Frame** in the transport bar) downloads the frame on screen as a PNG at the clip's native resolution, and stores it in `FRAMES_DIR` (default `./storage/frames`) + the `frames` table. The sidebar's **Frames** tab shows every saved frame; click one to view it full size, download it, jump to it on the timeline, or delete it.

## Scripts

`npm run db:up` / `db:down` · `db:generate` (after schema changes) · `db:migrate` · `db:studio` · `typecheck` · `lint`
