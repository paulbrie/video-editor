"use client";

import { Fragment, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

const ROWS: [ReactNode, string][] = [
  [<Kbd key="a">Space</Kbd>, "Play / pause"],
  [<><Kbd>←</Kbd> <Kbd>→</Kbd> or <Kbd>,</Kbd> <Kbd>.</Kbd></>, "Previous / next frame"],
  [<><Kbd>⇧</Kbd> + <Kbd>←</Kbd> <Kbd>→</Kbd></>, "Jump 1 second"],
  [<><Kbd>J</Kbd> <Kbd>L</Kbd></>, "Jump 5 seconds back / forward"],
  [<><Kbd>↑</Kbd> <Kbd>↓</Kbd></>, "Previous / next cut point"],
  [<><Kbd>Home</Kbd> <Kbd>End</Kbd></>, "Start / end of timeline"],
  [<Kbd key="s">S</Kbd>, "Split clip at playhead (current frame starts the new clip)"],
  [<><Kbd>[</Kbd> <Kbd>]</Kbd></>, "Trim clip start / end to the current frame"],
  [<Kbd key="b">⌫</Kbd>, "Move the selected clip to the Trash (gap closes; restore it from the Trash tab)"],
  [<Kbd key="t">T</Kbd>, "Add / remove a cross-dissolve at the cut nearest the playhead"],
  [<Kbd key="d">D</Kbd>, "Duplicate selected clip"],
  [<Kbd key="f2">F2</Kbd>, "Rename the selected clip (or right-click a clip / media item)"],
  [<Kbd key="e">E</Kbd>, "Save the current frame: downloads a PNG and adds it to the Frames tab"],
  [<><Kbd>I</Kbd> <Kbd>O</Kbd></>, "Mark in / out (the out frame is included)"],
  [<><Kbd>C</Kbd> / <Kbd>K</Kbd></>, "Cut the marked range / keep only the marked range"],
  [<Kbd key="x">X</Kbd>, "Clear marks"],
  [<><Kbd>⌘Z</Kbd> <Kbd>⇧⌘Z</Kbd></>, "Undo / redo"],
  [<Kbd key="ms">⌘S</Kbd>, "Save project now (it also autosaves)"],
  [<><Kbd>+</Kbd> <Kbd>−</Kbd> <Kbd>Z</Kbd></>, "Zoom timeline in / out / fit"],
  [<><Kbd>M</Kbd> <Kbd>F</Kbd></>, "Mute / fullscreen"],
  [<Kbd key="n">N</Kbd>, "Show / hide the project's notes"],
  ["Mouse", "Drag a clip to reorder it; drag its edges to trim; click or drag the ruler to scrub"],
  ["Transitions", "Click the ◇ on a cut for a cross-dissolve or dip to black; the ones at the ends fade in / out"],
  ["Audio", "Drag audio clips in time or between A1/A2; with one selected, S / [ ] / ⌫ / D act on it. Cut/Keep range affect all tracks"],
];

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
          {ROWS.map(([keys, desc], i) => (
            <Fragment key={i}>
              <div className="flex items-center justify-end gap-1 whitespace-nowrap">{keys}</div>
              <div className="text-muted-foreground">{desc}</div>
            </Fragment>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
