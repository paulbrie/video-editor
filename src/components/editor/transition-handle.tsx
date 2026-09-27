"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_TRANSITION, type Transition, type TransitionWindow } from "@/lib/editor/engine";
import { cn } from "@/lib/utils";
import { useEditor } from "./context";

type Props = {
  /** "cut" between clip i-1 and i, or the fade at either end of the edit. */
  kind: "cut" | "fadein" | "fadeout";
  segId: string;
  value: Transition | null;
  /** Clamped window actually used (if the transition is on). */
  window?: TransitionWindow;
  x: number;
  top: number;
  height: number;
};

const LABEL = { dissolve: "Cross-dissolve", dip: "Dip to black" } as const;

/** Small diamond on a cut: click to pick a transition and its duration. */
export function TransitionHandle({ kind, segId, value, window, x, top, height }: Props) {
  const [open, setOpen] = useState(false);
  const on = !!value;
  const title =
    kind === "fadein" ? "Fade in from black" : kind === "fadeout" ? "Fade out to black" : value ? LABEL[value.type] : "Add a transition";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          // keep the timeline from scrubbing / selecting underneath
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "absolute z-[7] grid size-[18px] -translate-x-1/2 -translate-y-1/2 rotate-45 place-items-center rounded-[3px] border text-[9px] shadow transition-opacity",
            on
              ? "border-primary bg-primary text-primary-foreground opacity-100"
              : "border-white/40 bg-[#1b1c20] opacity-40 hover:opacity-100 data-[state=open]:opacity-100",
          )}
          style={{ left: x, top: top + height / 2 }}
        >
          <span className="-rotate-45 leading-none font-bold">
            {kind === "cut" ? (value?.type === "dip" ? "◐" : "⋈") : kind === "fadein" ? "◢" : "◣"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" onOpenAutoFocus={(e) => e.preventDefault()}>
        <TransitionForm kind={kind} segId={segId} value={value} window={window} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function TransitionForm({
  kind,
  segId,
  value,
  window,
  onDone,
}: Omit<Props, "x" | "top" | "height"> & { onDone: () => void }) {
  const editor = useEditor();
  const [duration, setDuration] = useState(value?.duration ?? DEFAULT_TRANSITION.duration);
  const apply = (t: Transition | null) => {
    if (kind === "fadeout") editor.setFadeOut(t ? t.duration : null);
    else editor.setTransition(segId, t);
  };
  const options: { label: string; t: Transition | null }[] =
    kind === "cut"
      ? [
          { label: "None", t: null },
          { label: LABEL.dissolve, t: { type: "dissolve", duration } },
          { label: LABEL.dip, t: { type: "dip", duration } },
        ]
      : [
          { label: "Off", t: null },
          { label: kind === "fadein" ? "Fade in" : "Fade out", t: { type: "dip", duration } },
        ];
  const current = value ? (kind === "cut" ? value.type : "dip") : null;

  return (
    <div className="grid gap-3 text-sm">
      <div className="font-medium">{kind === "cut" ? "Transition at this cut" : kind === "fadein" ? "Start of the edit" : "End of the edit"}</div>
      <div className="grid gap-1">
        {options.map((o) => {
          const active = (o.t?.type ?? null) === current;
          return (
            <Button
              key={o.label}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className={cn("justify-start", active && "text-primary")}
              onClick={() => apply(o.t)}
            >
              {o.label}
            </Button>
          );
        })}
      </div>
      {value && (
        <div className="grid gap-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Duration</span>
            <span className="tabular-nums">
              {duration.toFixed(2)} s
              {window && window.d < duration - 0.005 && ` (fits ${window.d.toFixed(2)} s)`}
            </span>
          </div>
          <Slider
            min={0.1}
            max={3}
            step={0.05}
            value={[duration]}
            onValueChange={([v]) => setDuration(v)}
            onValueCommit={([v]) => apply({ type: value.type, duration: v })}
            aria-label="Transition duration"
          />
        </div>
      )}
      {kind === "cut" && (
        <div className="flex gap-1.5 border-t pt-2">
          <Button
            variant="outline"
            size="xs"
            className="flex-1"
            disabled={!value}
            onClick={() => {
              if (value) editor.setAllTransitions(value);
              onDone();
            }}
          >
            Use on all cuts
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="flex-1"
            onClick={() => {
              editor.setAllTransitions(null);
              onDone();
            }}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
