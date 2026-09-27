"use client";

import { useState } from "react";
import { useSubject } from "subjecto/react";
import { CheckIcon, CloudIcon, CloudOffIcon, FolderOpenIcon, LoaderIcon, NotebookPenIcon, PlusIcon, SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { useEditor } from "./context";
import { ProjectsDialog } from "./projects-dialog";
import { HelpDialog } from "./help-dialog";
import { ExportDialog } from "./export-dialog";

type Props = {
  onAddVideos: () => void;
  helpOpen: boolean;
  setHelpOpen: (v: boolean) => void;
  exportOpen: boolean;
  setExportOpen: (v: boolean) => void;
  notesOpen: boolean;
  setNotesOpen: (v: boolean) => void;
};

export function Header({ onAddVideos, helpOpen, setHelpOpen, exportOpen, setExportOpen, notesOpen, setNotesOpen }: Props) {
  const editor = useEditor();
  const [project] = useSubject(editor.project$);
  const [edit] = useSubject(editor.edit$);
  const [projectsOpen, setProjectsOpen] = useState(false);

  const status = {
    saved: { icon: <CheckIcon className="size-3.5" />, text: "Saved" },
    dirty: { icon: <CloudIcon className="size-3.5" />, text: "Unsaved changes" },
    saving: { icon: <LoaderIcon className="size-3.5 animate-spin" />, text: "Saving…" },
    error: { icon: <CloudOffIcon className="size-3.5 text-destructive" />, text: "Save failed" },
  }[project.save];

  return (
    <header className="flex items-center gap-2 border-b bg-card px-3">
      <div className="mr-2 flex items-center gap-2 font-bold tracking-wide">
        <i className="inline-block size-2.5 rounded-[2px] bg-primary" />
        Cutroom
      </div>
      <Button variant="outline" size="sm" onClick={onAddVideos}>
        <PlusIcon /> Add media
      </Button>
      <Button variant="outline" size="sm" onClick={() => setProjectsOpen(true)}>
        <FolderOpenIcon /> Open project
      </Button>
      <Button variant="outline" size="sm" onClick={() => editor.saveNow()} title="Save now (⌘S) — changes also autosave">
        <SaveIcon /> Save project
      </Button>
      <div className="ml-2 flex min-w-0 items-center gap-2">
        <ProjectName key={project.id + project.name} value={project.name} onCommit={(n) => editor.renameProject(n)} />
        <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
          {status.icon}
          {status.text}
        </span>
      </div>
      <span className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        aria-pressed={notesOpen}
        className={notesOpen ? "border-primary text-primary" : ""}
        onClick={() => setNotesOpen(!notesOpen)}
        title="Project notes (N)"
      >
        <NotebookPenIcon /> Notes
        {!notesOpen && project.notes.trim() && <span className="size-1.5 rounded-full bg-primary" aria-label="has notes" />}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setHelpOpen(true)}>
        Shortcuts <Kbd>?</Kbd>
      </Button>
      <Button size="sm" className="font-semibold" disabled={!edit.segs.length} onClick={() => setExportOpen(true)}>
        Export video
      </Button>

      <ProjectsDialog open={projectsOpen} onOpenChange={setProjectsOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </header>
  );
}

/** Remounted (via key) whenever the saved name changes, so its draft starts from the stored value. */
function ProjectName({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <Input
      aria-label="Project name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (draft.trim() ? onCommit(draft) : setDraft(value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      className="h-7 w-56 border-transparent bg-transparent px-2 font-medium shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
    />
  );
}
