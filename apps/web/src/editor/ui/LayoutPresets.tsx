"use client";

import { useState } from "react";
import type { LayoutPreset } from "@chitrapx/document";
import { useEditor, useEditorStore } from "../context.tsx";

const ROWS: Array<[string, Array<[LayoutPreset, string]>]> = [
  ["Text", [["text-top", "Top"], ["text-middle", "Middle"], ["text-bottom", "Bottom"]]],
  ["Phone", [["phone-center", "Center"], ["phone-hero", "Hero"], ["phone-bleed", "Bleed"], ["phone-tilt", "Tilt"]]],
];

/** One-click placement for the selected text or phone (or the first one on the board). */
export function LayoutPresets({ groupId, boardId }: { groupId: string; boardId: string }) {
  const store = useEditorStore();
  const [notice, setNotice] = useState("");
  const board = useEditor((s) => s.doc.groups.find((g) => g.id === groupId)?.boards.find((b) => b.id === boardId));

  function apply(preset: LayoutPreset) {
    const s = store.getState();
    const spans = s.selection.some((r) => r.boardId === null);
    const elementIds = s.selection.filter((r) => r.groupId === groupId && r.boardId === boardId).map((r) => r.elementId);
    const detached = Object.entries(board?.localized ?? {}).filter(([, byEl]) =>
      Object.values(byEl).some((ov) => (ov as { detached?: string[] }).detached?.some((k) => k === "position" || k === "size"))).map(([loc]) => loc);
    s.apply({ type: "applyLayoutPreset", groupId, boardId, preset, elementIds });
    setNotice([
      spans ? "Elements across boards are not moved by presets." : "",
      detached.length ? `${detached.join(", ")} keep their own layout for some elements.` : "",
    ].filter(Boolean).join(" "));
  }

  return (
    <div className="space-y-1">
      <h3 className="label">Layout</h3>
      {ROWS.map(([title, presets]) => (
        <div key={title} className="flex flex-wrap items-center gap-1" role="group" aria-label={`${title} layout`}>
          <span className="w-12 text-xs text-neutral-500">{title}</span>
          {presets.map(([p, text]) => <button key={p} type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => apply(p)}>{text}</button>)}
        </div>
      ))}
      {notice && <p className="text-xs text-amber-700" role="status">{notice}</p>}
    </div>
  );
}
