"use client";

import { useState } from "react";
import type { MarkStyle, StylePatch } from "@chitrapx/document";

type RangeStyle = { [K in keyof MarkStyle]: MarkStyle[K] | "mixed" | undefined };
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;
/** Keeps the textarea's focus and selection while a toolbar button is pressed. */
const keep = (e: React.MouseEvent) => e.preventDefault();

/** Styles the selected words: colour (with brand swatches), gradient, weight, italic, clear. Each press is one undo step. */
export function RichTextToolbar({ style, onApply, swatches = [] }: {
  style: RangeStyle; onApply: (patch: StylePatch | "clear") => void; swatches?: Array<{ label: string; value: string; hex: string }>;
}) {
  const [from, setFrom] = useState("#ff3d71");
  const [to, setTo] = useState("#7b61ff");
  const [angle, setAngle] = useState(90);
  const color = typeof style.color === "string" && /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#000000";
  return (
    <div role="toolbar" aria-label="Style the selected words" className="flex flex-wrap items-center gap-1 rounded-md border border-neutral-200 bg-white p-1 shadow dark:border-neutral-700 dark:bg-neutral-900">
      <input type="color" aria-label="Colour of the selected words" value={color} onChange={(e) => onApply({ color: e.target.value })} className="h-7 w-8" />
      {swatches.map((s) => (
        <button key={s.value} type="button" onMouseDown={keep} onClick={() => onApply({ color: s.value })} title={`Brand ${s.label}`} aria-label={`Brand ${s.label}`}
          className="h-6 w-6 rounded border border-neutral-300" style={{ background: s.hex }} />
      ))}
      <select aria-label="Weight of the selected words" className="input h-7 w-24 py-0" value={typeof style.fontWeight === "number" ? String(style.fontWeight) : ""}
        onChange={(e) => onApply({ fontWeight: Number(e.target.value) })}>
        <option value="" disabled>{style.fontWeight === "mixed" ? "Mixed" : "Weight"}</option>
        {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
      <button type="button" onMouseDown={keep} aria-pressed={style.italic === true} className={style.italic === true ? "btn px-2" : "btn-ghost px-2"}
        onClick={() => onApply({ italic: style.italic !== true })}><em>I</em></button>
      <span className="flex items-center gap-1">
        <input type="color" aria-label="Gradient start" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 w-7" />
        <input type="color" aria-label="Gradient end" value={to} onChange={(e) => setTo(e.target.value)} className="h-7 w-7" />
        <input type="number" aria-label="Gradient angle" value={angle} min={0} max={359} onChange={(e) => setAngle(Number(e.target.value) || 0)} className="input h-7 w-14 py-0" />
        <button type="button" onMouseDown={keep} className="btn-ghost px-2"
          onClick={() => onApply({ gradient: { kind: "linear", angle, stops: [{ color: from, at: 0 }, { color: to, at: 1 }] } })}>Gradient</button>
      </span>
      <button type="button" onMouseDown={keep} className="btn-ghost px-2" onClick={() => onApply("clear")}>Clear</button>
    </div>
  );
}
