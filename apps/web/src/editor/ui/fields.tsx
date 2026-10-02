"use client";

import { useEffect, useState } from "react";
import { isColor } from "@chitrapx/document";
import { useEditorStore } from "../context.tsx";

/** Form controls whose whole edit (focus to blur) is one undo step. */
export function useGesture() {
  const store = useEditorStore();
  return { onFocus: () => store.getState().beginGesture(), onBlur: () => store.getState().endGesture() };
}

export function Row({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function NumberField({ id, label, value, onChange, step = 1, min, max }: {
  id: string; label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number;
}) {
  const g = useGesture();
  return (
    <Row label={label} htmlFor={id}>
      <input id={id} type="number" className="input" step={step} min={min} max={max} value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} {...g} />
    </Row>
  );
}

/** Free text is applied only once it is a colour the document accepts, so a half-typed value never breaks saving. */
export function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const g = useGesture();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  const valid = text === "" || isColor(text);
  return (
    <Row label={label} htmlFor={id}>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} className="h-9 w-10 shrink-0 rounded border border-neutral-300 dark:border-neutral-700" value={hex} onChange={(e) => onChange(e.target.value)} {...g} />
        <input id={id} className={`input ${valid ? "" : "border-red-500"}`} aria-invalid={!valid} value={text}
          onChange={(e) => { setText(e.target.value); if (e.target.value === "" || isColor(e.target.value)) onChange(e.target.value); }} {...g} />
      </div>
    </Row>
  );
}

export function SelectField<T extends string>({ id, label, value, options, onChange }: {
  id: string; label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void;
}) {
  return (
    <Row label={label} htmlFor={id}>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Row>
  );
}

export type PickerAsset = { id: string; url: string; width: number | null; height: number | null; kind?: string };

export function AssetPicker({ assets, value, onPick, label }: { assets: PickerAsset[]; value?: string; onPick: (src: string | undefined) => void; label: string }) {
  return (
    <Row label={label}>
      {assets.length === 0 ? (
        <p className="text-xs text-neutral-500">Upload screenshots on the app page to use them here.</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {assets.map((a) => (
            <button key={a.id} type="button" onClick={() => onPick(`asset:${a.id}`)} title={`${a.width}x${a.height}`}
              className={`overflow-hidden rounded border ${value === `asset:${a.id}` ? "border-indigo-500 ring-2 ring-indigo-500/40" : "border-neutral-300 dark:border-neutral-700"}`}>
              <img src={a.url} alt="" className="aspect-[9/16] w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {value && <button type="button" className="mt-1 text-xs text-neutral-500 hover:underline" onClick={() => onPick(undefined)}>Remove picture</button>}
    </Row>
  );
}
