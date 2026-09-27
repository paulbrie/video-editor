"use client";

import { useSubject } from "subjecto/react";
import {
  CameraIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StepBackIcon,
  StepForwardIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { tc } from "@/lib/editor/format";
import { useEditor } from "./context";

const RATES = ["0.1", "0.25", "0.5", "1", "1.5", "2", "4"];

function Tip({ label, keys, children }: { label: string; keys?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label} {keys && <Kbd>{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function Timecode() {
  const editor = useEditor();
  const [play] = useSubject(editor.play$);
  useSubject(editor.edit$); // clip count / durations
  useSubject(editor.sources$); // fps edits
  const fi = editor.frameInfo();
  if (!fi)
    return (
      <div className="min-w-0 tabular-nums">
        <div className="font-mono text-xl tracking-wide">00:00:00:00</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">No clip</div>
      </div>
    );
  const s = editor.src(fi.sg.src)!;
  return (
    <div className="min-w-0 tabular-nums">
      <div className="font-mono text-xl tracking-wide">
        {tc(play.t, fi.fps)} <small className="text-xs text-muted-foreground">/ {tc(editor.total(), fi.fps)}</small>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
        Clip {fi.i + 1}/{editor.segs.length} · {editor.clipLabel(fi.sg)} · source frame {fi.f} ({tc(fi.f / fi.fps, fi.fps)}) · {s.fps} fps
      </div>
    </div>
  );
}

export function Transport() {
  const editor = useEditor();
  const [play] = useSubject(editor.play$);
  const [view] = useSubject(editor.view$);
  const [edit] = useSubject(editor.edit$);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t bg-card px-3 py-2">
      <Timecode />
      <div className="flex gap-1">
        <Tip label="Previous cut" keys="↑">
          <Button variant="outline" size="icon" onClick={() => editor.prevEdit()}><SkipBackIcon /></Button>
        </Tip>
        <Tip label="Previous frame" keys="←">
          <Button variant="outline" size="icon" onClick={() => editor.step(-1)}><StepBackIcon /></Button>
        </Tip>
        <Tip label="Play / pause" keys="Space">
          <Button variant="outline" className="w-14" onClick={() => editor.togglePlay()}>
            {play.playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
          </Button>
        </Tip>
        <Tip label="Next frame" keys="→">
          <Button variant="outline" size="icon" onClick={() => editor.step(1)}><StepForwardIcon /></Button>
        </Tip>
        <Tip label="Next cut" keys="↓">
          <Button variant="outline" size="icon" onClick={() => editor.nextEdit()}><SkipForwardIcon /></Button>
        </Tip>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Select value={String(view.rate)} onValueChange={(v) => editor.setRate(Number(v))}>
          <SelectTrigger size="sm" className="w-[76px]" title="Playback speed"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RATES.map((r) => (
              <SelectItem key={r} value={r}>{r}×</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tip label="Loop (marked range if set)">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={view.loop}
            className={view.loop ? "border-primary text-primary" : ""}
            onClick={() => editor.toggleLoop()}
          >
            <RepeatIcon /> Loop
          </Button>
        </Tip>
        <Tip label="Mute" keys="M">
          <Button
            variant="outline"
            size="icon-sm"
            className={view.muted ? "border-primary text-primary" : ""}
            onClick={() => editor.setMuted(!view.muted)}
          >
            {view.muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
        </Tip>
        <Slider
          className="w-20"
          min={0}
          max={1}
          step={0.01}
          value={[view.muted ? 0 : view.volume]}
          onValueChange={([v]) => editor.setVolume(v)}
          aria-label="Volume"
        />
        <Tip label="Export current frame as PNG" keys="E">
          <Button variant="outline" size="sm" disabled={!edit.segs.length} onClick={() => editor.exportFrame()}>
            <CameraIcon /> Frame
          </Button>
        </Tip>
        <Tip label="Fullscreen" keys="F">
          <Button variant="outline" size="icon-sm" onClick={() => window.dispatchEvent(new Event("cutroom:fullscreen"))}>
            <MaximizeIcon />
          </Button>
        </Tip>
      </div>
    </div>
  );
}
