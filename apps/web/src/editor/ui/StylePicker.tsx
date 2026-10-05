"use client";

import { useState } from "react";
import { applyStyle, BRAND_TOKENS, STYLES, type TextElementProps } from "@chitrapx/document";
import { ensureFont, fitTextBox } from "@chitrapx/renderer";
import { api } from "@/server/api.ts";
import { useEditorAssets } from "../assets.tsx";
import { useEditor, useEditorStore } from "../context.tsx";

/** 18 named looks; one click restyles every board of the active size as one undo step. */
export function StylePicker() {
  const store = useEditorStore();
  const groupId = useEditor((s) => s.activeGroupId);
  const current = useEditor((s) => s.doc.groups.find((g) => g.id === s.activeGroupId)?.styleId);
  const { appId } = useEditorAssets();
  const [savePalette, setSavePalette] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(id: string) {
    const style = STYLES.find((s) => s.id === id)!;
    const doc = store.getState().doc;
    if (!doc.groups.find((g) => g.id === groupId)?.boards.length) { setNotice("Add a board to this size first"); return; }
    setBusy(true); setNotice("");
    try {
      // Measure with the style's real faces, or the boxes would be sized for a fallback.
      await Promise.all([ensureFont(style.fonts.heading, style.headline.weight), ensureFont(style.fonts.body, style.body.weight)]);
      const styled = applyStyle(doc, groupId, id);
      const fits: Record<string, NonNullable<ReturnType<typeof fitTextBox>>> = {};
      for (const b of styled.groups.find((g) => g.id === groupId)!.boards) {
        for (const e of b.elements) {
          if (e.type !== "text") continue;
          const fit = fitTextBox(e as TextElementProps, (e as TextElementProps).content);
          if (fit) fits[`${b.id}:${e.id}`] = fit;
        }
      }
      store.getState().apply({ type: "applyStyle", groupId, styleId: id, fits });
      if (savePalette) await api(`/api/apps/${appId}`, "PATCH", { brand: { palette: BRAND_TOKENS.map((t) => ({ token: t, color: style.palette[t] })) } });
    } catch (err) { setNotice((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="space-y-2">
      <h2 className="label">Style</h2>
      <div className="grid grid-cols-3 gap-1.5">
        {STYLES.map((s) => (
          <button key={s.id} type="button" disabled={busy} onClick={() => pick(s.id)} title={s.description} aria-pressed={current === s.id}
            className={`overflow-hidden rounded border text-left ${current === s.id ? "border-indigo-500 ring-2 ring-indigo-500/40" : "border-neutral-300 dark:border-neutral-700"}`}>
            <img src={`/styles/${s.id}.png`} alt="" className="aspect-[9/19.5] w-full object-cover" loading="lazy" />
            <span className="block truncate px-1 py-0.5 text-[10px]">{s.name}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={savePalette} onChange={(e) => setSavePalette(e.target.checked)} /> Also save as my brand palette
      </label>
      {notice && <p role="status" className="text-xs text-amber-700">{notice}</p>}
    </section>
  );
}
