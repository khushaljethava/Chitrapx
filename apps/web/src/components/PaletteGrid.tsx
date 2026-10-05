"use client";

import { BRAND_TOKENS, contrastRatio, type BrandPalette, type BrandToken } from "@chitrapx/document";

const LABELS: Record<BrandToken, string> = { primary: "Primary", secondary: "Secondary", accent: "Accent", surface: "Surface", text: "Text", muted: "Muted" };
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Six named slots, each a hex field and a picker; Reset restores what is saved. Warns when text on surface is hard to read. */
export function PaletteGrid({ value, onChange, saved }: { value: BrandPalette; onChange: (p: BrandPalette) => void; saved: BrandPalette }) {
  const set = (t: BrandToken, v: string) => { const next = { ...value }; if (v) next[t] = v; else delete next[t]; onChange(next); };
  const ratio = value.text && value.surface ? contrastRatio(value.text, value.surface) : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BRAND_TOKENS.map((t) => (
          <div key={t}>
            <label className="label" htmlFor={`pal-${t}`}>{LABELS[t]}</label>
            <div className="flex gap-2">
              <input type="color" aria-label={`${LABELS[t]} picker`} className="h-9 w-10 rounded border border-neutral-300 dark:border-neutral-700"
                value={HEX.test(value[t] ?? "") ? value[t] : "#000000"} onChange={(e) => set(t, e.target.value)} />
              <input id={`pal-${t}`} className={`input ${value[t] && !HEX.test(value[t]!) ? "border-red-500" : ""}`} placeholder="#4F46E5" value={value[t] ?? ""}
                onChange={(e) => set(t, e.target.value.trim())} />
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={() => onChange(saved)}>Reset</button>
      {ratio !== null && ratio < 4.5 && <p role="status" className="text-xs text-amber-700">Text on Surface is {ratio.toFixed(1)}:1. Aim for at least 4.5:1 so copy stays readable.</p>}
    </div>
  );
}
