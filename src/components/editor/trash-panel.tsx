"use client";

import { useState } from "react";
import { useSubject } from "subjecto/react";
import { ArrowDownToLineIcon, MusicIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
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
import type { Source, TrashItem } from "@/lib/editor/engine";
import { fmt } from "@/lib/editor/format";
import { cn } from "@/lib/utils";
import { useEditor } from "./context";

function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

export function TrashPanel() {
  const editor = useEditor();
  const [edit] = useSubject(editor.edit$);
  const [sources] = useSubject(editor.sources$);
  const [armedEmpty, setArmedEmpty] = useState(false);
  const trash = edit.trash;
  const files = sources.filter((s) => s.trashed);
  const empty = trash.length === 0 && files.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {empty && (
          <div className="px-1.5 py-5 text-center leading-relaxed text-muted-foreground">
            Trash is empty.
            <br />
            Clips and media files you delete land here, so you can put them back.
          </div>
        )}
        {files.length > 0 && (
          <>
            <div className="px-1.5 pt-1 pb-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Media files</div>
            {files.map((s) => (
              <TrashedFileRow key={s.id} s={s} clips={trash.filter((i) => i.media === s.id).length} />
            ))}
          </>
        )}
        {trash.length > 0 && (
          <>
            {files.length > 0 && (
              <div className="px-1.5 pt-3 pb-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Clips</div>
            )}
            {trash.map((item) => (
              <TrashRow key={item.clip.id} item={item} />
            ))}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex-1">Right-click an item for more options.</span>
        {!empty && (
          <Button
            variant={armedEmpty ? "destructive" : "ghost"}
            size="xs"
            onClick={() => {
              if (!armedEmpty) {
                setArmedEmpty(true);
                setTimeout(() => setArmedEmpty(false), 3000);
                return;
              }
              editor.emptyTrash();
              setArmedEmpty(false);
            }}
          >
            {armedEmpty ? (files.length ? "Delete files from disk?" : "Empty it?") : "Empty trash"}
          </Button>
        )}
      </div>
    </div>
  );
}

function TrashRow({ item }: { item: TrashItem }) {
  const editor = useEditor();
  const [sources] = useSubject(editor.sources$);
  const [armed, setArmed] = useState(false);
  const s = sources.find((x) => x.id === item.clip.src);
  const len = item.clip.out - item.clip.in;
  const restore = () => editor.restoreFromTrash(item.clip.id, "original");
  const insert = () => editor.restoreFromTrash(item.clip.id, "playhead");
  const purge = () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3000);
      return;
    }
    editor.purgeFromTrash(item.clip.id);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-lg p-1.5 hover:bg-secondary data-[state=open]:bg-secondary"
          onDoubleClick={restore}
          title="Double-click to put it back where it was"
        >
          <div
            className="relative h-[42px] w-[72px] overflow-hidden rounded bg-black bg-cover bg-center opacity-80"
            style={{
              backgroundImage: s?.thumbnail ? `url(${s.thumbnail})` : undefined,
              boxShadow: `inset 0 -3px 0 ${s?.color ?? "#888"}`,
              ...(item.kind === "audio" && {
                backgroundColor: `color-mix(in oklab, ${s?.color ?? "#888"} 30%, #0b0c0e)`,
                backgroundSize: "100% 70%",
                backgroundRepeat: "no-repeat",
              }),
            }}
          >
            {item.kind === "audio" && <MusicIcon className="absolute top-1 left-1 size-3 text-white/80" />}
            <span className="absolute right-[3px] bottom-[5px] rounded-[3px] bg-black/70 px-[3px] text-[10px] tabular-nums">
              {fmt(len)}
            </span>
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{editor.clipLabel(item.clip)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {item.kind === "audio" ? `Audio · A${item.clip.track + 1}` : "Video"} · {ago(item.deletedAt)}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <Button variant="outline" size="icon-xs" title="Put back where it was" onClick={restore}>
              <RotateCcwIcon />
            </Button>
            <Button
              variant={armed ? "destructive" : "outline"}
              size="icon-xs"
              title={armed ? "Click again to delete forever" : "Delete forever"}
              onClick={purge}
              className={cn(!armed && "opacity-0 group-hover:opacity-100")}
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={restore}>
          <RotateCcwIcon /> Put back where it was
        </ContextMenuItem>
        <ContextMenuItem onSelect={insert}>
          <ArrowDownToLineIcon /> Insert at playhead
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => editor.purgeFromTrash(item.clip.id)}>
          <Trash2Icon /> Delete forever
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A media file in the Trash: still on disk until deleted for good. */
function TrashedFileRow({ s, clips }: { s: Source; clips: number }) {
  const editor = useEditor();
  const [confirm, setConfirm] = useState(false);
  const restore = () => editor.restoreSource(s.id);
  return (
    <>
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{s.name}” forever?</AlertDialogTitle>
          <AlertDialogDescription>
            The file is deleted from disk{clips ? `, along with the ${clips} trashed clip${clips > 1 ? "s that use" : " that uses"} it` : ""}.
            This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => editor.deleteSourceForever(s.id)}>
            Delete forever
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-lg p-1.5 hover:bg-secondary data-[state=open]:bg-secondary"
          onDoubleClick={restore}
          title="Double-click to restore the file and its clips"
        >
          <div
            className="relative h-[42px] w-[72px] overflow-hidden rounded bg-black bg-cover bg-center opacity-80"
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
            <span className="absolute right-[3px] bottom-[5px] rounded-[3px] bg-black/70 px-[3px] text-[10px] tabular-nums">
              {fmt(s.duration)}
            </span>
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{s.name}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {s.kind === "audio" ? "Audio file" : "Video file"}
              {clips ? ` · ${clips} clip${clips > 1 ? "s" : ""}` : ""}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <Button variant="outline" size="icon-xs" title="Restore the file and its clips" onClick={restore}>
              <RotateCcwIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-xs"
              title="Delete forever (removes the file from disk)"
              onClick={() => setConfirm(true)}
              className="opacity-0 group-hover:opacity-100"
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem onSelect={restore}>
          <RotateCcwIcon /> Restore file{clips ? " and its clips" : ""}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
          <Trash2Icon /> Delete forever…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    </>
  );
}
