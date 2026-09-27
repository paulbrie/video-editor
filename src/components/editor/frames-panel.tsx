"use client";

import { useState } from "react";
import { useSubject } from "subjecto/react";
import { ChevronLeftIcon, ChevronRightIcon, CrosshairIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import type { Frame } from "@/db/schema";
import { fmtBytes, tc } from "@/lib/editor/format";
import { useEditor } from "./context";

export function FramesPanel() {
  const editor = useEditor();
  const [frames] = useSubject(editor.frames$);
  const [openId, setOpenId] = useState<string | null>(null);
  const index = frames.findIndex((f) => f.id === openId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {frames.length === 0 ? (
          <div className="px-1.5 py-5 text-center leading-relaxed text-muted-foreground">
            No frames yet.
            <br />
            Press <Kbd>E</Kbd> or <b>Frame</b> under the player to save the frame on screen.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {frames.map((f) => (
              <button
                key={f.id}
                onClick={() => setOpenId(f.id)}
                className="group relative aspect-video overflow-hidden rounded-md bg-black text-left ring-primary outline-none hover:ring-2 focus-visible:ring-2"
                title={`${f.videoName} · frame ${f.frameNumber}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL thumbnail */}
                <img src={f.thumbnail} alt="" className="size-full object-contain" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 pt-3 pb-0.5 text-[10px] leading-tight">
                  <span className="font-medium tabular-nums">#{f.frameNumber}</span>{" "}
                  <span className="text-[#bbb]">{f.videoName}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        Frames exported in this project, newest first. Click one to view it full size.
      </div>
      <FrameViewer frames={frames} index={index} onOpen={setOpenId} />
    </div>
  );
}

function FrameViewer({ frames, index, onOpen }: { frames: Frame[]; index: number; onOpen: (id: string | null) => void }) {
  const editor = useEditor();
  const [armed, setArmed] = useState(false);
  const f = frames[index];
  const fps = f?.videoId ? editor.src(f.videoId)?.fps : undefined;
  const go = (d: number) => {
    const i = index + d;
    if (i >= 0 && i < frames.length) {
      setArmed(false);
      onOpen(frames[i].id);
    }
  };

  return (
    <Dialog
      open={!!f}
      onOpenChange={(v) => {
        if (v) return;
        setArmed(false);
        onOpen(null);
      }}
    >
      <DialogContent
        className="gap-3 sm:max-w-[min(1100px,calc(100vw-4rem))]"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1);
          if (e.key === "ArrowRight") go(1);
        }}
      >
        {f && (
          <>
            <div className="pr-8">
              <DialogTitle className="truncate">
                {f.videoName} — frame {f.frameNumber}
              </DialogTitle>
              <DialogDescription className="tabular-nums">
                {fps ? `${tc(f.time, fps)} · ` : `${f.time.toFixed(3)} s · `}
                {f.width}×{f.height} · {fmtBytes(f.size)} · saved {new Date(f.createdAt).toLocaleString()}
              </DialogDescription>
            </div>
            <div className="relative grid place-items-center overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our API at full resolution */}
              <img
                key={f.id}
                src={`/api/frames/${f.id}/image`}
                alt={`${f.videoName}, frame ${f.frameNumber}`}
                className="max-h-[68vh] w-auto max-w-full object-contain"
                style={{ aspectRatio: `${f.width} / ${f.height}` }}
              />
              {index > 0 && (
                <Button variant="secondary" size="icon" className="absolute left-2 opacity-80" onClick={() => go(-1)} title="Newer (←)">
                  <ChevronLeftIcon />
                </Button>
              )}
              {index < frames.length - 1 && (
                <Button variant="secondary" size="icon" className="absolute right-2 opacity-80" onClick={() => go(1)} title="Older (→)">
                  <ChevronRightIcon />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {index + 1} of {frames.length}
              </span>
              <span className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (editor.goToFrame(f)) onOpen(null);
                }}
              >
                <CrosshairIcon /> Go to frame
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/frames/${f.id}/image?download=1`} download>
                  <DownloadIcon /> Download PNG
                </a>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  if (!armed) return setArmed(true);
                  setArmed(false);
                  const next = frames[index + 1] ?? frames[index - 1];
                  onOpen(next?.id ?? null);
                  await editor.deleteFrame(f.id);
                }}
              >
                <Trash2Icon /> {armed ? "Click again to delete" : "Delete"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
