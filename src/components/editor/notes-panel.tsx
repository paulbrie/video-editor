"use client";

import { useRef } from "react";
import { useSubject } from "subjecto/react";
import { ClockIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tc } from "@/lib/editor/format";
import { useEditor } from "./context";

/** Per-project notepad, docked on the right of the editor. Saved with the project. */
export function NotesPanel({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const [project] = useSubject(editor.project$);
  const area = useRef<HTMLTextAreaElement>(null);
  const words = project.notes.trim() ? project.notes.trim().split(/\s+/).length : 0;

  /** Put the playhead's timecode at the cursor, e.g. "[00:01:23:10] ". */
  const insertTimecode = () => {
    const el = area.current;
    if (!el) return;
    const fi = editor.frameInfo();
    const stamp = `[${tc(editor.play$.getValue().t, fi?.fps ?? 30)}] `;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const atLineStart = a === 0 || value[a - 1] === "\n";
    const text = (atLineStart ? "" : "\n") + stamp;
    editor.setNotes(value.slice(0, a) + text + value.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = a + text.length;
    });
  };

  return (
    <aside className="flex min-h-0 flex-col border-l bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Notes</div>
          <div className="truncate text-xs text-muted-foreground">{project.name}</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close notes (N)">
          <XIcon />
        </Button>
      </div>
      <textarea
        ref={area}
        value={project.notes}
        onChange={(e) => editor.setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        placeholder={"Ideas, shot list, feedback to address…\n\nTip: “Insert timecode” stamps the playhead position."}
        spellCheck
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
        aria-label="Project notes"
      />
      <div className="flex items-center gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex-1 tabular-nums">
          {words} word{words === 1 ? "" : "s"} · autosaved
        </span>
        <Button variant="outline" size="xs" onClick={insertTimecode} title="Insert the playhead's timecode at the cursor">
          <ClockIcon /> Insert timecode
        </Button>
      </div>
    </aside>
  );
}
