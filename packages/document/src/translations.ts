import { produce, type Draft } from "immer";
import type { ArtboardState, ElementLocaleOverride, TextElementProps } from "./artboard.ts";
import type { ChitrapxDoc } from "./doc.ts";
import { allTexts, type SlotText } from "./ai.ts";
import type { ChipsElementProps } from "./artboard.ts";
import { CHIP_BUDGET, CHIP_MAX_CHARS, chipId, chipsSource, normalizeChipOverride, parseChipId } from "./chips.ts";
import { hash32 } from "./hash.ts";
import { remapMarks } from "./richText.ts";

/** One text of the translations table. Element ids repeat across sizes, so one id is one row, on the first board it appears on. */
export type TranslationRow = {
  id: string;
  elementId: string;
  board: string;
  boardId: string;
  label: string;
  /** The base-language text of this row. */
  base: string;
  /** What `sourceHash` fingerprints for this row. */
  source: string;
  /** Chips rows: which chip of the element. */
  chip?: number;
};
export type CellState = "untranslated" | "auto" | "manual" | "stale-auto" | "stale-manual";
export type TranslationCell = { text: string; state: CellState };
/** One typed or imported cell. '' clears it back to the base. */
export type TranslationWrite = { locale: string; id: string; text: string };

const LABEL_LIMIT = 40;

/** The layer name, or the start of the text when nobody named the layer. */
export function rowLabel(el: { name?: string; content?: string }): string {
  const name = el.name?.trim();
  if (name) return name;
  const text = (el.content ?? "").replace(/\s+/g, " ").trim();
  return text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text;
}

/** Every localizable text once, in board order of the first size it appears in. Empty texts are not rows; chips are one row each. */
export function translationRows(doc: ChitrapxDoc): TranslationRow[] {
  const seen = new Set<string>();
  const rows: TranslationRow[] = [];
  for (const g of doc.groups) for (const b of g.boards) for (const e of b.elements) {
    if (seen.has(e.id)) continue;
    if (e.type === "text") {
      const t = e as TextElementProps;
      if (!t.content?.trim()) continue;
      seen.add(t.id);
      rows.push({ id: t.id, elementId: t.id, board: b.name, boardId: b.id, label: rowLabel(t), base: t.content, source: t.content });
    } else if (e.type === "chips") {
      const c = e as ChipsElementProps;
      seen.add(c.id);
      const name = c.name?.trim() || "Chip";
      c.chips.forEach((chip, i) => rows.push({ id: chipId(c.id, i), elementId: c.id, chip: i, board: b.name, boardId: b.id, label: `${name} ${i + 1}`, base: chip, source: chipsSource(c.chips) }));
    }
  }
  return rows;
}

/** First override per (locale, element id), built once per document; documents are never mutated. */
const indexes = new WeakMap<ChitrapxDoc, Map<string, ElementLocaleOverride>>();
export function overrideOf(doc: ChitrapxDoc, locale: string, elementId: string): ElementLocaleOverride | undefined {
  let index = indexes.get(doc);
  if (!index) {
    index = new Map();
    for (const g of doc.groups) for (const b of g.boards) for (const [loc, byEl] of Object.entries(b.localized ?? {})) {
      for (const [id, ov] of Object.entries(byEl ?? {})) {
        const key = `${loc}\u0000${id}`;
        if (ov && !index.has(key)) index.set(key, ov);
      }
    }
    indexes.set(doc, index);
  }
  return index.get(`${locale}\u0000${elementId}`);
}

function stateOf(ov: ElementLocaleOverride, source: string): CellState {
  // No origin means typed, imported or written by an older build: treated as a person's, never overwritten.
  const kind = ov.origin === "auto" ? "auto" : "manual";
  // No hash means we cannot know, and flagging every legacy translation would teach people to ignore the flag.
  return ov.sourceHash && ov.sourceHash !== hash32(source) ? `stale-${kind}` : kind;
}

export function cellFor(doc: ChitrapxDoc, row: TranslationRow, locale: string): TranslationCell {
  const ov = overrideOf(doc, locale, row.elementId);
  const text = (row.chip === undefined ? ov?.content : ov?.chips?.[row.chip]) ?? "";
  return text.trim() ? { text, state: stateOf(ov!, row.source) } : { text: "", state: "untranslated" };
}

/** The "4/6" and stale count in a language's column header. */
export function localeProgress(doc: ChitrapxDoc, locale: string): { translated: number; total: number; stale: number } {
  const rows = translationRows(doc);
  let translated = 0;
  let stale = 0;
  for (const row of rows) {
    const { state } = cellFor(doc, row, locale);
    if (state === "untranslated") continue;
    translated++;
    if (state.startsWith("stale")) stale++;
  }
  return { translated, total: rows.length, stale };
}

/** Advice under a cell. What renders is still decided by auto-shrink at render time; chips wrap or drop. */
export function lengthWarning(row: TranslationRow, text: string): string | null {
  if (!text) return null;
  if (row.chip !== undefined) return text.length > CHIP_BUDGET ? "Chips fit best at 16 characters or fewer" : null;
  return text.length > Math.ceil(row.base.length * 1.5) + 4 ? "Longer than the source; it may shrink or wrap" : null;
}

/** Stores `next` as the override, or removes it and any map it leaves empty. */
function put(b: Draft<ArtboardState>, locale: string, id: string, next: ElementLocaleOverride) {
  const byEl = ((b.localized ??= {})[locale] ??= {});
  if (Object.keys(next).length) byEl[id] = next;
  else delete byEl[id];
  if (!Object.keys(byEl).length) delete b.localized![locale];
  if (!Object.keys(b.localized!).length) delete b.localized;
}

/**
 * The single writer for typed and imported translations: marked manual (a person wrote or reviewed it, so AI
 * translation keeps it) and hashed against today's base text, on every board holding the id. '' clears back to
 * the base. Returns `doc` itself when nothing changes, so a no-op edit adds no undo step.
 */
export function writeTranslations(doc: ChitrapxDoc, writes: TranslationWrite[]): ChitrapxDoc {
  const known = new Set(doc.localization.locales.map((l) => l.code));
  const texts = new Map<string, string>();
  const chipEdits = new Map<string, Map<number, string>>();
  for (const w of writes) {
    if (!known.has(w.locale)) continue;
    const text = w.text.replace(/\r\n?/g, "\n");
    const chip = parseChipId(w.id);
    if (chip) {
      const key = `${w.locale}\u0000${chip.elementId}`;
      chipEdits.set(key, (chipEdits.get(key) ?? new Map()).set(chip.index, text.replace(/\s+/g, " ").trim().slice(0, CHIP_MAX_CHARS)));
    } else texts.set(`${w.locale}\u0000${w.id}`, text);
  }
  if (!texts.size && !chipEdits.size) return doc;
  return produce(doc, (d) => {
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      for (const locale of known) {
        const current = b.localized?.[locale]?.[e.id];
        if (e.type === "chips") {
          const el = e as unknown as ChipsElementProps;
          const edits = chipEdits.get(`${locale}\u0000${el.id}`);
          if (!edits) continue;
          const list = el.chips.map((_, i) => current?.chips?.[i] ?? "");
          for (const [i, t] of edits) if (i < list.length) list[i] = t;
          const chips = normalizeChipOverride(list, el.chips.length);
          if (JSON.stringify(chips) === JSON.stringify(current?.chips)) continue;
          const next: ElementLocaleOverride = { ...current };
          if (chips) { next.chips = chips; next.origin = "manual"; next.sourceHash = hash32(chipsSource(el.chips)); }
          else { delete next.chips; delete next.origin; delete next.sourceHash; }
          put(b, locale, el.id, next);
          continue;
        }
        if (e.type !== "text") continue;
        const base = (e as TextElementProps).content ?? "";
        const text = texts.get(`${locale}\u0000${e.id}`);
        if (text === undefined || (current?.content ?? "") === text) continue;
        const next: ElementLocaleOverride = { ...current };
        if (text === "") {
          delete next.content; delete next.marks; delete next.origin; delete next.sourceHash;
        } else {
          if (next.marks?.length) {
            const m = remapMarks(current?.content ?? base, text, next.marks);
            if (m.length) next.marks = m; else delete next.marks;
          }
          next.content = text;
          next.origin = "manual";
          next.sourceHash = hash32(base);
        }
        put(b, locale, e.id, next);
      }
    }
  });
}

/** Every distinct text as `locale` reads it: that language's own text where it has one, the base text otherwise. */
export function textsIn(doc: ChitrapxDoc, locale: string): SlotText[] {
  const all = allTexts(doc);
  if (locale === doc.localization.baseLocale) return all;
  return all.map((t) => {
    const chip = parseChipId(t.id);
    const ov = overrideOf(doc, locale, chip ? chip.elementId : t.id);
    const own = chip ? ov?.chips?.[chip.index] : ov?.content;
    return own?.trim() ? { id: t.id, text: own } : t;
  });
}
