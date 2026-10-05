"use client";

import { useState } from "react";
import { CHIP_BUDGET, CHIP_MAX, chipId, type ChipsElementProps, type ElementLocaleOverride } from "@chitrapx/document";
import { api } from "@/server/api.ts";
import { chipEditError } from "../chipsModel.ts";
import type { Ref } from "../commands.ts";
import { useEditor, useEditorStore } from "../context.tsx";
import { useDocJob } from "../docJobs.tsx";

/** A placeholder no other chip has, so adding two in a row is never refused as a repeat (F6). */
const newChipName = (chips: string[]) => {
  const taken = new Set(chips.map((c) => c.toLowerCase()));
  let n = 1;
  while (taken.has(n === 1 ? "new chip" : `new chip ${n}`)) n++;
  return n === 1 ? "New chip" : `New chip ${n}`;
};

/** A chips list. The base language owns the order and the count; another language edits the words only. */
export function ChipsEditor({ refr, el, locale }: { refr: Ref; el: ChipsElementProps; locale: string | null }) {
  const store = useEditorStore();
  const run = useDocJob();
  const projectId = useEditor((s) => s.projectId);
  const locked = useEditor((s) => s.locked);
  const override = useEditor((s): ElementLocaleOverride | undefined => locale && refr.boardId
    ? s.doc.groups.find((g) => g.id === refr.groupId)?.boards.find((b) => b.id === refr.boardId)?.localized?.[locale]?.[refr.elementId] : undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chips = el.chips ?? [];

  const setBase = (next: string[], from: number[]) => store.getState().apply({ type: "setChips", ref: refr, chips: next, from });
  const identity = () => chips.map((_, k) => k);
  const remove = (i: number) => { const order = identity().filter((k) => k !== i); setBase(order.map((k) => chips[k]!), order); };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= chips.length) return;
    const order = identity();
    [order[i], order[j]] = [order[j]!, order[i]!];
    setBase(order.map((k) => chips[k]!), order);
  };
  function edit(i: number, text: string) {
    setError("");
    if (locale) store.getState().apply({ type: "setTranslations", writes: [{ locale, id: chipId(el.id, i), text }] });
    else if (!text.trim()) remove(i);
    else {
      const refused = chipEditError(chips, i, text);
      if (refused) setError(refused);
      else setBase(chips.map((c, k) => (k === i ? text : c)), identity());
    }
  }
  async function regenerate() {
    setBusy(true);
    setError("");
    try { await run(() => api<{ jobId: string }>(`/api/projects/${projectId}/chips`, "POST")); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="space-y-1.5" aria-label="Chips">
      <h3 className="label">Chips</h3>
      {chips.map((chip, i) => {
        const value = locale ? override?.chips?.[i] ?? "" : chip;
        return (
          <div key={i} className="flex items-center gap-1">
            <input key={`${i}:${value}`} className="input flex-1 py-1 text-xs" dir="auto" defaultValue={value} placeholder={chip} disabled={locked}
              aria-label={`Chip ${i + 1}${locale ? ` in ${locale}` : ""}`} onBlur={(e) => e.target.value !== value && edit(i, e.target.value)} />
            {value.length > CHIP_BUDGET && <span className="text-[10px] text-amber-700" title="Chips fit best at 16 characters or fewer">long</span>}
            {!locale && (
              <>
                <button type="button" className="btn-ghost px-1 py-0.5 text-xs" aria-label={`Move chip ${i + 1} up`} disabled={i === 0 || locked} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn-ghost px-1 py-0.5 text-xs" aria-label={`Move chip ${i + 1} down`} disabled={i === chips.length - 1 || locked} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn-ghost px-1 py-0.5 text-xs" aria-label={`Delete chip ${i + 1}`} disabled={locked} onClick={() => remove(i)}>x</button>
              </>
            )}
          </div>
        );
      })}
      {locale ? (
        <p className="text-xs text-neutral-500">Order and number of chips are shared by every language.</p>
      ) : (
        <div className="flex gap-1">
          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={chips.length >= CHIP_MAX || locked}
            onClick={() => setBase([...chips, newChipName(chips)], [...identity(), -1])}>Add chip</button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy || locked} onClick={regenerate}>
            {busy ? "Writing chips" : "Regenerate chips (1 credit)"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="error text-xs">{error}</p>}
    </section>
  );
}
