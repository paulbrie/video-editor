"use client";

import { useEffect, useRef, useState } from "react";
import type { Frame, Project, Video } from "@/db/schema";
import { Editor } from "@/lib/editor/engine";
import { EditorContext } from "./context";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { NotesPanel } from "./notes-panel";
import { Stage } from "./stage";
import { Transport } from "./transport";
import { Timeline } from "./timeline";
import { useShortcuts } from "./use-shortcuts";
import { cn } from "@/lib/utils";

export function EditorApp({ videos, project, frames }: { videos: Video[]; project: Project; frames: Frame[] }) {
  const [editor] = useState(() => new Editor({ videos, project, frames }));
  const fileInput = useRef<HTMLInputElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useShortcuts(editor, {
    blocked: exportOpen,
    openHelp: () => setHelpOpen(true),
    helpOpen,
  });

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      editor.flushOnUnload();
      if (editor.hasPendingWork()) e.preventDefault();
    };
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragDepth.current++;
      setDragging(true);
    };
    const leave = () => {
      if (--dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    };
    const over = (e: DragEvent) => e.preventDefault();
    const toggleNotes = () => setNotesOpen((v) => !v);
    window.addEventListener("cutroom:notes", toggleNotes);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) editor.addFiles(e.dataTransfer.files);
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("cutroom:notes", toggleNotes);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [editor]);

  const pickFiles = () => fileInput.current?.click();

  return (
    <EditorContext.Provider value={editor}>
      <div
        className={cn(
          "grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[46px_minmax(0,1fr)_280px] overflow-hidden text-[13px] select-none",
          dragging && "is-dragover",
        )}
      >
        <Header
          onAddVideos={pickFiles}
          helpOpen={helpOpen}
          setHelpOpen={setHelpOpen}
          exportOpen={exportOpen}
          setExportOpen={setExportOpen}
          notesOpen={notesOpen}
          setNotesOpen={setNotesOpen}
        />
        <main
          className={cn(
            "grid min-h-0",
            notesOpen ? "grid-cols-[260px_minmax(0,1fr)_320px]" : "grid-cols-[260px_minmax(0,1fr)]",
          )}
        >
          <Sidebar />
          <section className="flex min-h-0 min-w-0 flex-col">
            <Stage onPick={pickFiles} dragging={dragging} />
            <Transport />
          </section>
          {notesOpen && <NotesPanel onClose={() => setNotesOpen(false)} />}
        </main>
        <Timeline />
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="video/*,audio/*,.mkv,.mov,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) editor.addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </EditorContext.Provider>
  );
}
