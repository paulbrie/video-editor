"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@/lib/editor/engine";

type Opts = { blocked: boolean; helpOpen: boolean; openHelp: () => void };

export function useShortcuts(editor: Editor, opts: Opts) {
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { blocked, helpOpen, openHelp } = ref.current;
      if (blocked || helpOpen) return;
      const el = e.target instanceof HTMLElement ? e.target : document.body;
      const tag = el.tagName;
      if (
        (tag === "INPUT" && !["range", "checkbox"].includes((el as HTMLInputElement).type)) ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        el.isContentEditable ||
        el.closest("[role=dialog],[role=alertdialog],[role=listbox],[role=menu]")
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      // letters by physical key, so shortcuts work on any keyboard layout
      const lk = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : k.toLowerCase();
      let handled = true;
      if (mod && lk === "z") {
        if (e.shiftKey) editor.redo();
        else editor.undo();
      }
      else if (mod && lk === "y") editor.redo();
      else if (mod && lk === "s") editor.saveNow();
      else if (mod) handled = false;
      else if (k === " ") editor.togglePlay();
      else if (k === "ArrowLeft" || k === ",") {
        if (e.shiftKey) editor.jump(-1);
        else editor.step(-1);
      }
      else if (k === "ArrowRight" || k === ".") {
        if (e.shiftKey) editor.jump(1);
        else editor.step(1);
      }
      else if (k === "ArrowUp") editor.prevEdit();
      else if (k === "ArrowDown") editor.nextEdit();
      else if (k === "Home") editor.toStart();
      else if (k === "End") editor.toEnd();
      else if (lk === "j") editor.jump(-5);
      else if (lk === "l") editor.jump(5);
      else if (lk === "s") editor.split();
      else if (k === "[") editor.trimIn();
      else if (k === "]") editor.trimOut();
      else if (k === "Backspace" || k === "Delete") editor.deleteSelected();
      else if (lk === "d") editor.duplicate();
      else if (lk === "e") editor.exportFrame();
      else if (k === "F2") window.dispatchEvent(new Event("cutroom:rename"));
      else if (lk === "t") editor.toggleNearestTransition();
      else if (lk === "n") window.dispatchEvent(new Event("cutroom:notes"));
      else if (lk === "i") editor.markIn();
      else if (lk === "o") editor.markOut();
      else if (lk === "c") editor.cutRange();
      else if (lk === "k") editor.keepRange();
      else if (lk === "x") editor.clearMarks();
      else if (k === "+" || k === "=") editor.setZoom(editor.view.zoom * 1.4);
      else if (k === "-" || k === "_") editor.setZoom(editor.view.zoom / 1.4);
      else if (lk === "z") window.dispatchEvent(new Event("cutroom:fit"));
      else if (lk === "m") editor.setMuted(!editor.view.muted);
      else if (lk === "f") window.dispatchEvent(new Event("cutroom:fullscreen"));
      else if (k === "?") openHelp();
      else if (k === "Escape") editor.select(null);
      else handled = false;
      if (handled) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);
}
