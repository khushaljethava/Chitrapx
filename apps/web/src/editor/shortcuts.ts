"use client";

import { useEffect } from "react";
import type { EditorStore } from "./store.ts";
import { duplicateSelection } from "./ui/Inspector.tsx";

export const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Editor shortcuts; ignored while a form field has focus so typing never removes or nudges an element. */
export function useShortcuts(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = store.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && key === "y") { e.preventDefault(); s.redo(); return; }
      if (mod && key === "d") { e.preventDefault(); duplicateSelection(store); return; }
      if (mod && key === "a") {
        e.preventDefault();
        const b = s.doc.groups.find((g) => g.id === s.activeGroupId)?.boards.find((x) => x.id === s.activeBoardId);
        if (b) s.select(b.elements.map((el) => ({ groupId: s.activeGroupId, boardId: b.id, elementId: el.id })));
        return;
      }
      if (e.key === "Escape") { s.select([]); return; }
      if (!s.selection.length) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); s.apply({ type: "deleteElements", refs: s.selection }); return; }
      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = arrows[e.key];
      if (move) { e.preventDefault(); s.apply({ type: "moveElements", refs: s.selection, dx: move[0], dy: move[1] }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}
