"use client";

import { useState } from "react";
import { LAYOUT_KEYS, matchElements, type ArtboardState } from "@chitrapx/document";
import type { Ref } from "../commands.ts";
import { useEditor, useEditorStore } from "../context.tsx";

function Confirm({ label, question, onYes }: { label: string; question: () => string; onYes: () => void }) {
  const [asking, setAsking] = useState<string | null>(null);
  if (asking === null) return <button type="button" className="btn-ghost w-full text-xs" onClick={() => setAsking(question())}>{label}</button>;
  return (
    <div className="space-y-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-700" role="alertdialog" aria-label={label}>
      <p>{asking}</p>
      <div className="flex gap-1">
        <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => { onYes(); setAsking(null); }}>Apply</button>
        <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setAsking(null)}>Cancel</button>
      </div>
    </div>
  );
}

/** Element section: copy this element's position and size (and a device's screenshot crop) to every other board. */
export function ApplyToBoards({ refr }: { refr: Ref }) {
  const store = useEditorStore();
  const group = useEditor((s) => s.doc.groups.find((g) => g.id === refr.groupId));
  if (!group || !refr.boardId || group.boards.length < 2) return null;
  const question = () => {
    const src = group.boards.find((b) => b.id === refr.boardId)! as ArtboardState;
    const others = group.boards.filter((b) => b.id !== refr.boardId);
    const missing = others.filter((b) => !matchElements(src, b as ArtboardState).has(refr.elementId)).map((b) => b.name);
    const n = others.length - missing.length;
    return `Change ${n} board${n === 1 ? "" : "s"}?${missing.length ? ` No matching element on: ${missing.join(", ")} (skipped).` : ""}`;
  };
  return <Confirm label="Apply position to all boards" question={question}
    onYes={() => store.getState().apply({ type: "applyToAllBoards", groupId: refr.groupId, sourceRef: refr })} />;
}

/** Board section: every language follows this board's base layout again; text stays translated. */
export function ApplyToLocales({ groupId, boardId }: { groupId: string; boardId: string }) {
  const store = useEditorStore();
  const locales = useEditor((s) => s.doc.localization.locales);
  const board = useEditor((s) => s.doc.groups.find((g) => g.id === groupId)?.boards.find((b) => b.id === boardId));
  if (!locales.length || !board) return null;
  const question = () => {
    const own = Object.entries(board.localized ?? {}).filter(([, byEl]) => Object.values(byEl).some((ov) =>
      (ov as { detached?: string[] }).detached?.some((k) => (LAYOUT_KEYS as readonly string[]).includes(k)))).map(([loc]) => loc);
    return own.length ? `${own.join(", ")} will follow this layout. Text stays translated.` : "Every language already follows this layout.";
  };
  return <Confirm label="Apply layout to all languages" question={question}
    onYes={() => store.getState().apply({ type: "applyLayoutToLocales", groupId, boardId })} />;
}
