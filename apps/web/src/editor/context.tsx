"use client";

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { EditorState, EditorStore } from "./store.ts";

export const EditorContext = createContext<EditorStore | null>(null);

export function useEditorStore(): EditorStore {
  const store = useContext(EditorContext);
  if (!store) throw new Error("useEditor outside <EditorContext>");
  return store;
}

/** Subscribe to one slice of editor state. */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(useEditorStore(), selector);
}
