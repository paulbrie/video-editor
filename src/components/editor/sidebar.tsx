"use client";

import { useState } from "react";
import { useSubject } from "subjecto/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditor } from "./context";
import { Library } from "./library";
import { FramesPanel } from "./frames-panel";
import { TrashPanel } from "./trash-panel";

export function Sidebar() {
  const editor = useEditor();
  const [sources] = useSubject(editor.sources$);
  const [frames] = useSubject(editor.frames$);
  const [edit] = useSubject(editor.edit$);
  const [tab, setTab] = useState("media");

  return (
    <aside className="flex min-h-0 flex-col border-r bg-card">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-2 my-2 w-auto self-stretch">
          <TabsTrigger value="media" className="text-xs">
            Media <span className="text-muted-foreground tabular-nums">{sources.filter((s) => !s.trashed).length || ""}</span>
          </TabsTrigger>
          <TabsTrigger value="frames" className="text-xs">
            Frames <span className="text-muted-foreground tabular-nums">{frames.length || ""}</span>
          </TabsTrigger>
          <TabsTrigger value="trash" className="text-xs">
            Trash{" "}
            <span className="text-muted-foreground tabular-nums">
              {edit.trash.length + sources.filter((s) => s.trashed).length || ""}
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="media" className="flex min-h-0 flex-col">
          <Library />
        </TabsContent>
        <TabsContent value="frames" className="flex min-h-0 flex-col">
          <FramesPanel />
        </TabsContent>
        <TabsContent value="trash" className="flex min-h-0 flex-col">
          <TrashPanel />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
