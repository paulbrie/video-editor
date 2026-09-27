"use client";

import { createContext, useContext } from "react";
import type { Editor } from "@/lib/editor/engine";

export const EditorContext = createContext<Editor | null>(null);

export function useEditor() {
  const e = useContext(EditorContext);
  if (!e) throw new Error("useEditor must be used inside <EditorContext>");
  return e;
}
