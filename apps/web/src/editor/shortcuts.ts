"use client";

import { useEffect } from "react";
import { mirrorsLocale } from "@chitrapx/renderer";
import { selectableRefs } from "./selection.ts";
import type { EditorStore } from "./store.ts";
import { duplicateSelection } from "./ui/Inspector.tsx";

export const isTypingTarget = (t: EventTarget | null) =>
  typeof HTMLElement !== "undefined" && t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** True when another widget owns this key: a handled event, a keyboard drag in the layers panel, or a modal dialog. */
export function shouldIgnoreKey(e: Pick<KeyboardEvent, "defaultPrevented" | "target">): boolean {
  if (e.defaultPrevented || isTypingTarget(e.target)) return true;
  const t = e.target as Element | null;
  if (t?.closest?.('[aria-roledescription="sortable"][aria-pressed="true"]')) return true; // dnd-kit keyboard drag in progress
  return !!t?.closest?.('[aria-modal="true"]');
}

/**
 * Arrow keys move the selection 1 px (10 with Shift). Returns true when the key is an arrow, so it is consumed.
 * A mirrored right-to-left view is preview-only, as on the canvas: base coordinates would move the opposite way.
 */
export function nudgeSelection(store: EditorStore, key: string, shift: boolean): boolean {
  const step = shift ? 10 : 1;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const move = arrows[key];
  if (!move) return false;
  const s = store.getState();
  if (mirrorsLocale(s.doc.localization, s.locale)) return true;
  const refs = selectableRefs(s.doc, s.selection);
  if (refs.length) s.apply({ type: "moveElements", refs, dx: move[0], dy: move[1] });
  return true;
}

/** Editor shortcuts; ignored while a form field has focus so typing never removes or nudges an element. */
export function useShortcuts(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreKey(e)) return;
      const s = store.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && key === "y") { e.preventDefault(); s.redo(); return; }
      if (mod && key === "d") { e.preventDefault(); duplicateSelection(store); return; }
      if (mod && key === "a") {
        e.preventDefault();
        const b = s.doc.groups.find((g) => g.id === s.activeGroupId)?.boards.find((x) => x.id === s.activeBoardId);
        if (b) s.select(b.elements.filter((el) => !el.locked && !el.hidden).map((el) => ({ groupId: s.activeGroupId, boardId: b.id, elementId: el.id })));
        return;
      }
      if (mod && key === "g") {
        e.preventDefault();
        if (e.shiftKey) s.apply({ type: "ungroupElements", refs: s.selection });
        else s.apply({ type: "groupElements", refs: s.selection, elementGroupId: crypto.randomUUID(), name: "Group" });
        return;
      }
      if (e.key === "Escape") { s.select([]); return; }
      if (!s.selection.length) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); s.apply({ type: "deleteElements", refs: s.selection }); return; }
      if (nudgeSelection(store, e.key, e.shiftKey)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}
