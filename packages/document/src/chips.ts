import { produce } from "immer";
import type { ChipsElementProps } from "./artboard.ts";
import type { ChitrapxDoc } from "./doc.ts";

export const CHIP_MAX = 6;
export const CHIP_MIN = 4;
/** Stored per chip; a translation may run longer than the AI budget. */
export const CHIP_MAX_CHARS = 24;
/** What the AI is held to, and what the table warns above. */
export const CHIP_BUDGET = 16;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, CHIP_MAX_CHARS).trim() : "");

/** A base list: trimmed, capped, no empty or repeated chips (case aside), at most six. */
export function normalizeChips(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const t = clean(v);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === CHIP_MAX) break;
  }
  return out;
}

/** A language's list: parallel to the base list, "" keeps the base chip; nothing left means no list. */
export function normalizeChipOverride(raw: unknown, baseLength: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.slice(0, Math.min(baseLength, CHIP_MAX)).map(clean);
  while (out.length && !out[out.length - 1]) out.pop();
  return out.length ? out : undefined;
}

/** What the AI proposed, held to the chip budget: one or two words, at most 16 characters, no repeats, at most six. */
export function aiChips(raw: unknown): string[] {
  const fits = (c: unknown) => typeof c === "string" && c.trim().length > 0 && c.trim().length <= CHIP_BUDGET && c.trim().split(/\s+/).length <= 2;
  return normalizeChips((Array.isArray(raw) ? raw : []).filter(fits));
}

/** The id one chip has in AI texts, the translations table and CSV files. */
export const chipId = (elementId: string, index: number) => `${elementId}#${index}`;
/** Element ids are UUIDs or template ids and never end in "#<digits>", so this cannot misread a text id. */
export function parseChipId(id: string): { elementId: string; index: number } | null {
  const m = /^(.+)#(\d+)$/.exec(id);
  return m ? { elementId: m[1]!, index: Number(m[2]) } : null;
}

/** What a chips override's sourceHash fingerprints. */
export const chipsSource = (chips: readonly string[]) => chips.join("\n");
export const isChips = (e: { type: string }): e is ChipsElementProps => e.type === "chips";
export const hasChips = (doc: ChitrapxDoc) => doc.groups.some((g) => [...g.spanElements, ...g.boards.flatMap((b) => b.elements)].some(isChips));

/** A language's list after the base list was reordered: `from[i]` is the old index of new chip i, -1 for a new chip. */
export function remapChipOverride(list: readonly string[] | undefined, from: readonly number[]): string[] | undefined {
  if (!list) return undefined;
  return normalizeChipOverride(from.map((j) => (j >= 0 ? list[j] ?? "" : "")), from.length);
}

/** New chips on every chips element (AI chips, AI design). The old chips' translations go with them. */
export function applyChips(doc: ChitrapxDoc, chips: string[]): ChitrapxDoc {
  const list = normalizeChips(chips);
  if (!list.length || !hasChips(doc)) return doc;
  return produce(doc, (d) => {
    for (const g of d.groups) {
      for (const e of g.spanElements) if (e.type === "chips") (e as unknown as ChipsElementProps).chips = [...list];
      for (const b of g.boards) {
        for (const e of b.elements) {
          if (e.type !== "chips") continue;
          (e as unknown as ChipsElementProps).chips = [...list];
          for (const byEl of Object.values(b.localized ?? {})) {
            const ov = byEl[e.id];
            if (!ov?.chips) continue;
            delete ov.chips; delete ov.origin; delete ov.sourceHash;
            if (!Object.keys(ov).length) delete byEl[e.id];
          }
        }
        for (const [locale, byEl] of Object.entries(b.localized ?? {})) if (!Object.keys(byEl).length) delete b.localized![locale];
        if (b.localized && !Object.keys(b.localized).length) delete b.localized;
      }
    }
  });
}
