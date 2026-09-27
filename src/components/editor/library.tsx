"use client";

import { useState } from "react";
import { useSubject } from "subjecto/react";
import { AlertTriangleIcon, MusicIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import type { Source } from "@/lib/editor/engine";
import { fmt, fmtBytes } from "@/lib/editor/format";
import { useEditor } from "./context";
import { RenameDialog, type RenameTarget } from "./rename-dialog";

export function Library() {
  const editor = useEditor();
  const [allSources] = useSubject(editor.sources$);
  const sources = allSources.filter((s) => !s.trashed); // trashed files live in the Trash tab
  const [edit] = useSubject(editor.edit$);
  const [pending, setPending] = useState<Source | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const rename = (s: Source) =>
    setRenaming({
      title: s.kind === "audio" ? "Rename audio file" : "Rename video",
      value: s.name,
      hint: "Changes the name in this project's media. Clips you haven't renamed show the new name.",
      onSave: (v) => editor.renameSource(s.id, v),
    });
  const uses = pending
    ? edit.segs.filter((s) => s.src === pending.id).length + edit.audio.filter((c) => c.src === pending.id).length
    : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sources.length === 0 && (
          <div className="px-1.5 py-5 text-center leading-relaxed text-muted-foreground">
            No media yet.
            <br />
            Add or drop video or audio files.
          </div>
        )}
        {sources.map((s) => (
          <LibraryItem key={s.id} s={s} onRemove={() => setPending(s)} onRename={() => rename(s)} />
        ))}
      </div>
      <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        Drop video or audio files anywhere. <b>+</b> adds a clip: videos at the end, audio at the playhead.
      </div>

      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.status === "ready" ? `Move “${pending?.name}” to the Trash?` : `Delete “${pending?.name}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.status === "ready" ? (
                <>
                  It leaves this project’s media
                  {uses ? `, and the ${uses} clip${uses > 1 ? "s" : ""} using it ${uses > 1 ? "go" : "goes"} to the Trash with it` : ""}. The
                  file stays on disk: restore it (and its clips) from the Trash tab any time.
                </>
              ) : (
                "This upload never finished, so it can’t be kept in the Trash — it will be deleted."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.status === "ready" ? "default" : "destructive"}
              onClick={() => {
                if (pending) editor.removeSource(pending.id);
                setPending(null);
              }}
            >
              {pending?.status === "ready" ? "Move to Trash" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RenameDialog target={renaming} onClose={() => setRenaming(null)} />
    </div>
  );
}

function LibraryItem({ s, onRemove, onRename }: { s: Source; onRemove: () => void; onRename: () => void }) {
  const editor = useEditor();
  const [fps, setFps] = useState(String(+s.fps.toFixed(3)));
  const commitFps = () => {
    const f = Number(fps);
    if (f >= 1 && f <= 240) editor.setFps(s.id, f);
    else setFps(String(+s.fps.toFixed(3)));
  };

  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <div
      className="grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-lg p-1.5 hover:bg-secondary data-[state=open]:bg-secondary"
      onDoubleClick={(e) => !(e.target as HTMLElement).closest("button,input") && editor.appendSource(s.id)}
      title={`${s.name} · ${fmtBytes(s.size)}`}
    >
      <div
        className="relative h-[42px] w-[72px] overflow-hidden rounded bg-black bg-cover bg-center"
        style={{
          backgroundImage: s.thumbnail ? `url(${s.thumbnail})` : undefined,
          boxShadow: `inset 0 -3px 0 ${s.color}`,
          ...(s.kind === "audio" && {
            backgroundColor: `color-mix(in oklab, ${s.color} 30%, #0b0c0e)`,
            backgroundSize: "100% 70%",
            backgroundRepeat: "no-repeat",
          }),
        }}
      >
        {s.kind === "audio" && <MusicIcon className="absolute top-1 left-1 size-3 text-white/80" />}
        {s.status === "uploading" && (
          <div className="absolute inset-0 flex items-end bg-black/55">
            <div className="h-[3px] bg-primary transition-[width]" style={{ width: `${s.progress * 100}%` }} />
            <span className="absolute inset-x-0 top-1 text-center text-[10px] font-medium tabular-nums">
              {Math.round(s.progress * 100)}%
            </span>
          </div>
        )}
        {s.status === "error" && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 text-destructive" title="Upload failed">
            <AlertTriangleIcon className="size-4" />
          </div>
        )}
        <span className="absolute right-[3px] bottom-[5px] rounded-[3px] bg-black/70 px-[3px] text-[10px] tabular-nums">
          {fmt(s.duration)}
        </span>
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium">{s.name}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {s.status === "uploading" ? (
            <span>Uploading…</span>
          ) : s.status === "error" ? (
            <span className="text-destructive">Upload failed</span>
          ) : s.kind === "audio" ? (
            <span>Audio</span>
          ) : (
            <>
              {s.width}×{s.height} ·
              <Input
                type="number"
                step="any"
                min={1}
                max={240}
                value={fps}
                onChange={(e) => setFps(e.target.value)}
                onBlur={commitFps}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="h-5 w-[64px] rounded-sm px-1 text-[11px] [appearance:textfield] md:text-[11px] [&::-webkit-inner-spin-button]:appearance-none"
                title="Frames per second (auto-detected; edit if wrong)"
              />
              fps
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <Button
          variant="outline"
          size="icon-xs"
          title={s.kind === "audio" ? "Add to an audio track at the playhead" : "Append to the timeline"}
          onClick={() => editor.appendSource(s.id)}
        >
          <PlusIcon />
        </Button>
        <Button variant="outline" size="icon-xs" title="Move to Trash" onClick={onRemove}>
          <XIcon />
        </Button>
      </div>
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-56">
      <ContextMenuItem onSelect={onRename} disabled={s.status !== "ready"}>
        <PencilIcon /> Rename…
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => editor.appendSource(s.id)}>
        <PlusIcon /> {s.kind === "audio" ? "Add at playhead" : "Add to end of timeline"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={onRemove}>
        <Trash2Icon /> Move to Trash…
      </ContextMenuItem>
    </ContextMenuContent>
    </ContextMenu>
  );
}
