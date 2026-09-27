"use client";

import { useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { ExternalLinkIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmt } from "@/lib/editor/format";
import { cn } from "@/lib/utils";
import { useEditor } from "./context";

type Row = { id: string; name: string; updatedAt: string; clips: number; duration: number };

export function ProjectsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const editor = useEditor();
  const [current] = useSubject(editor.project$);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    editor.saveNow().then(() =>
      fetch("/api/projects")
        .then((r) => r.json())
        .then((d) => alive && setRows(d))
        .catch(() => toast.error("Could not load projects")),
    );
    return () => {
      alive = false;
      setArmed(null);
    };
  }, [open, editor]);

  const remove = async (id: string) => {
    if (armed !== id) return setArmed(id);
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Could not delete the project");
    setRows((r) => r?.filter((x) => x.id !== id) ?? null);
    setArmed(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Projects</DialogTitle>
          <DialogDescription>
            Each project has its own media, frames and address — ⌘-click (or use{" "}
            <ExternalLinkIcon className="inline size-3" />) to open one in a new tab. Projects autosave as you edit.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-80 overflow-y-auto">
          {!rows && <div className="p-3 text-muted-foreground">Loading…</div>}
          {rows?.map((p) => (
            <div
              key={p.id}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted",
                p.id === current.id && "bg-muted/60",
              )}
            >
              <a
                href={`/p/${p.id}`}
                className="min-w-0 flex-1 text-left"
                onClick={async (e) => {
                  // plain click: save and switch this tab; modified clicks open a new tab natively
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpenChange(false);
                  await editor.openProject(p.id);
                }}
              >
                <div className="truncate font-medium">
                  {p.name}
                  {p.id === current.id && <span className="ml-2 text-xs text-primary">open</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.clips} clip{p.clips === 1 ? "" : "s"} · {fmt(p.duration)} · edited{" "}
                  {new Date(p.updatedAt).toLocaleString()}
                </div>
              </a>
              <Button variant="ghost" size="icon-sm" asChild title="Open in a new tab">
                <a href={`/p/${p.id}`} target="_blank" rel="noopener">
                  <ExternalLinkIcon />
                </a>
              </Button>
              {p.id !== current.id && (
                <Button
                  variant={armed === p.id ? "destructive" : "ghost"}
                  size={armed === p.id ? "sm" : "icon-sm"}
                  className={cn(armed !== p.id && "opacity-0 group-hover:opacity-100")}
                  onClick={() => remove(p.id)}
                  title="Delete project"
                >
                  {armed === p.id ? "Delete with its media?" : <Trash2Icon />}
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          onClick={async () => {
            onOpenChange(false);
            await editor.newProject();
          }}
        >
          <PlusIcon /> New project
        </Button>
      </DialogContent>
    </Dialog>
  );
}
