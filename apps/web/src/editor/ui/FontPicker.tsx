"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { catalogFont } from "@chitrapx/document";
import { cssFontFamily, ensureFont } from "@chitrapx/renderer";
import { fontRows, GROUP_LABELS, type FontRow } from "../fontPickerModel.ts";

const CATEGORIES = [["all", "All"], ["sans-serif", "Sans serif"], ["serif", "Serif"], ["display", "Display"], ["handwriting", "Handwriting"], ["monospace", "Monospace"]] as const;

/** A row whose name is drawn in its own face once it scrolls into view (nothing loads before that). */
function PreviewRow({ row, selected, onPick }: { row: FontRow; selected: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setVisible(true); io.disconnect(); } });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (visible && catalogFont(row.family)) void ensureFont(row.family); }, [visible, row.family]);
  return (
    <button ref={ref} type="button" role="option" aria-selected={selected} onClick={onPick}
      className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${selected ? "bg-indigo-50 dark:bg-indigo-950" : ""}`}
      style={visible ? { fontFamily: cssFontFamily(row.family) } : undefined}>
      {row.family}
    </button>
  );
}

export function FontPicker({ id, label, value, onChange, used = [], custom = [], onUpload }: {
  id: string; label: string; value: string; onChange: (family: string) => void;
  used?: string[]; custom?: Array<{ family: string }>; onUpload?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const rows = useMemo(() => fontRows({ query, category, used, custom: custom.map((c) => c.family) }), [query, category, used, custom]);
  const pick = (family: string) => { onChange(family); setOpen(false); setQuery(""); };
  return (
    <div className="relative space-y-1">
      <label className="label" htmlFor={id}>{label}</label>
      <button id={id} type="button" className="input flex w-full items-center justify-between text-left" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} style={{ fontFamily: cssFontFamily(value) }}>
        <span className="truncate">{value || "Choose a font"}</span><span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <input autoFocus className="input mb-2" placeholder="Search fonts" aria-label="Search fonts" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="input mb-2" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
            {(["used", "custom", "google", "system"] as const).map((g) => {
              const inGroup = rows.filter((r) => r.group === g);
              if (!inGroup.length && !(g === "custom" && onUpload)) return null;
              return (
                <div key={g} className="mb-2">
                  <div className="flex items-center justify-between px-2 text-xs font-medium text-neutral-500">
                    <span>{GROUP_LABELS[g]}</span>
                    {g === "custom" && onUpload && <button type="button" className="text-indigo-600 hover:underline" onClick={() => { setOpen(false); onUpload(); }}>Upload font</button>}
                  </div>
                  {inGroup.map((r) => <PreviewRow key={`${g}:${r.family}`} row={r} selected={r.family === value} onPick={() => pick(r.family)} />)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
