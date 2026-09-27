"use client";

import { useEffect, useRef } from "react";
import { useSubject } from "subjecto/react";
import { useEditor } from "./context";
import { cn } from "@/lib/utils";

export function Stage({ onPick, dragging }: { onPick: () => void; dragging: boolean }) {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const [sources] = useSubject(editor.sources$);

  useEffect(() => {
    const el = ref.current!;
    editor.attach(el);
    const fs = () => (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen());
    window.addEventListener("cutroom:fullscreen", fs);
    return () => {
      window.removeEventListener("cutroom:fullscreen", fs);
      editor.detach();
    };
  }, [editor]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
      {/* the engine owns this node's children (one <video> per source) */}
      <div ref={ref} className="stage absolute inset-0" />
      {sources.length === 0 && (
        <button
          onClick={onPick}
          className="absolute inset-6 flex flex-col items-center justify-center gap-2.5 rounded-[14px] border-2 border-dashed border-[#34363c] text-center text-muted-foreground"
        >
          <b className="text-base text-foreground">Drop videos or audio here</b>
          <span>
            or click to choose files. Videos play back to back in the order added;
            <br />
            audio files go on the audio tracks at the playhead.
          </span>
        </button>
      )}
      <div
        className={cn(
          "pointer-events-none absolute inset-3 z-10 place-items-center rounded-[14px] border-2 border-dashed border-primary bg-primary/5 text-lg text-primary",
          dragging ? "grid" : "hidden",
        )}
      >
        Drop to add
      </div>
    </div>
  );
}
