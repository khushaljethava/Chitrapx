import { produce, type Draft } from "immer";
import { z } from "zod";
import type { ArtboardElement, TextElementProps } from "./artboard.ts";
import type { BoardGroup, ChitrapxDoc } from "./doc.ts";
import type { ChipsElementProps } from "./artboard.ts";
import { CHIP_MAX_CHARS, chipId, chipsSource, normalizeChipOverride } from "./chips.ts";
import { fillScreenshots } from "./fill.ts";
import { remapMarks } from "./richText.ts";
import { hash32 } from "./hash.ts";

/**
 * What the models return. They never produce document JSON: only these small plans,
 * which the appliers below turn into documents.
 */
export const screenInsightSchema = z.object({
  summary: z.string().describe("One sentence: what this screen lets the user do"),
  feature: z.string().describe("The single feature or benefit this screen best demonstrates"),
  uiElements: z.array(z.string()).describe("Notable UI elements visible on screen"),
  mood: z.string().describe("Visual mood in a few words"),
  dominantColors: z.array(z.string()).describe("Up to 4 dominant colours as #RRGGBB"),
  textOnScreen: z.string().describe("Important text visible in the screenshot, verbatim"),
});

/** SP11: competitor images per app's reference board; also the most `ai_reference` charges for at once. */
export const MAX_REFERENCES_PER_APP = 10;

export const competitorInsightSchema = z.object({
  headline: z.string().describe("The screenshot's headline, verbatim"),
  benefit: z.string().describe("The benefit it claims, in a few words"),
  layout: z.string().describe("The layout pattern: device placement, text position, decoration"),
  colourMood: z.string().describe("Colour mood in a few words"),
  differentiate: z.string().describe("What a rival app could say or show differently or better"),
});
export type CompetitorInsight = z.infer<typeof competitorInsightSchema>;
export const competitorSummarySchema = z.object({ summary: z.string().describe("3 to 6 plain sentences: the competitive angle") });

const words = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** True when `text` repeats a competitor headline of three or more words, case, spacing and punctuation aside. */
export function competitorEchoes(text: string, headlines: string[]): boolean {
  const t = ` ${words(text)} `;
  return headlines.some((h) => { const n = words(h); return n.split(" ").length >= 3 && t.includes(` ${n} `); });
}
export type ScreenInsight = z.infer<typeof screenInsightSchema>;

export const templateChoiceSchema = z.object({
  templateSlug: z.string(),
  screenshotOrder: z.array(z.number().int()).describe("Screenshot indices in the order they should appear, best first"),
  reasoning: z.string(),
  featureGraphicSlug: z.string().optional().describe("Only when asked: the Google Play feature graphic template slug"),
});
export type TemplateChoice = z.infer<typeof templateChoiceSchema>;

const slotText = z.object({ id: z.string(), text: z.string() });
export type SlotText = z.infer<typeof slotText>;

export const slotCopySchema = z.object({
  boards: z.array(z.object({ boardIndex: z.number().int(), texts: z.array(slotText) })),
  featureGraphic: z.array(slotText).optional().describe("Only when asked: text for the feature graphic's slots"),
  features: z.array(z.string()).optional().describe("Only when asked: 4 to 6 feature chips, most important first"),
});
export type SlotCopy = z.infer<typeof slotCopySchema>;

export const translationsSchema = z.object({ texts: z.array(slotText) });

export const TONES = ["confident", "warm", "punchy"] as const;
export const variantsSchema = z.object({
  variants: z.array(z.object({ tone: z.enum(TONES), texts: z.array(slotText) })),
});

/** SP11: the chips writer's answer, filtered by aiChips before use. */
export const chipsPlanSchema = z.object({ features: z.array(z.string()).describe("4 to 6 feature chips, most important first") });
export type CopyVariants = z.infer<typeof variantsSchema>;

export type TextSlot = { id: string; role: string; text: string; maxChars: number };

const budget = (text: string) => Math.max(40, text.length * 2);
const isText = (e: ArtboardElement): e is TextElementProps => e.type === "text";

/** Text slots of the first group, per board: what the copywriter fills. */
export function textSlots(doc: ChitrapxDoc): TextSlot[][] {
  return (doc.groups[0]?.boards ?? []).map((b) => b.elements.filter(isText).map((e) => ({
    id: e.id, role: e.name?.trim() || e.id, text: e.content ?? "", maxChars: budget(e.content ?? ""),
  })));
}

/** Every distinct base text in the document (deduplicated by id across boards and sizes); chips as `<id>#<n>`. */
export function allTexts(doc: ChitrapxDoc): SlotText[] {
  const seen = new Map<string, string>();
  for (const g of doc.groups) for (const b of g.boards) for (const e of b.elements) {
    if (isText(e)) { if (!seen.has(e.id)) seen.set(e.id, e.content ?? ""); }
    else if (e.type === "chips") (e as ChipsElementProps).chips.forEach((c, i) => { const id = chipId(e.id, i); if (!seen.has(id)) seen.set(id, c); });
  }
  return [...seen].map(([id, text]) => ({ id, text }));
}

/**
 * Builds the designed document: screenshots into device screens in the chosen order (invalid or
 * repeated indices dropped, missing ones appended), and copy only into slots that exist as text
 * on that board, trimmed and capped to the slot's budget.
 */
/**
 * Which screenshots (positions in the ordered list) each board of the first group shows, walking
 * empty device screens exactly as fillScreenshots does: board by board, left to right.
 */
export function screenshotsPerBoard(doc: ChitrapxDoc, n: number): number[][] {
  let next = 0;
  return (doc.groups[0]?.boards ?? []).map((b) => b.elements
    .filter((e) => (e.type === "device" || e.type === "video-device") && !(e as { screenshotSrc?: string }).screenshotSrc)
    .sort((a, z) => a.position.x - z.position.x)
    .flatMap(() => (next < n ? [next++] : [])));
}

/** A usable screenshot order: valid, unique indices first, then any the model left out. */
export function repairOrder(order: number[], n: number): number[] {
  const out = [...new Set(order.filter((i) => Number.isInteger(i) && i >= 0 && i < n))];
  for (let i = 0; i < n; i++) if (!out.includes(i)) out.push(i);
  return out;
}

/** New wording for a text: its marks follow the edit like typing does, never left at offsets of the old words. */
function setContent(el: TextElementProps, next: string) {
  if (el.marks?.length) {
    const marks = remapMarks(el.content ?? "", next, el.marks);
    if (marks.length) el.marks = marks; else delete el.marks;
  }
  el.content = next;
}

export function applyDesign(template: ChitrapxDoc, plan: { screenshotOrder: number[]; boards: SlotCopy["boards"] }, screenshotAssetIds: string[]): ChitrapxDoc {
  const order = repairOrder(plan.screenshotOrder, screenshotAssetIds.length);
  const filled = fillScreenshots(template, order.map((i) => screenshotAssetIds[i]!));
  return produce(filled, (d) => {
    const boards = d.groups[0]?.boards ?? [];
    for (const { boardIndex, texts } of plan.boards) {
      const b = boards[boardIndex];
      if (!b) continue;
      for (const { id, text } of texts) {
        const el = b.elements.find((e) => e.id === id && e.type === "text") as TextElementProps | undefined;
        if (el) setContent(el, text.trim().slice(0, budget(el.content ?? "")));
      }
    }
  });
}

/**
 * SP11: appends the feature graphic template's size to `doc` with its copy written in. Every id is prefixed "fg-",
 * so they never meet the main template's ids (texts are translated by element id across sizes). No-op when the
 * document already has a feature graphic.
 */
export function withFeatureGraphic(doc: ChitrapxDoc, fg: ChitrapxDoc, texts: SlotText[]): ChitrapxDoc {
  const src = fg.groups.find((g) => g.target === "play-feature");
  if (!src || doc.groups.some((g) => g.target === "play-feature")) return doc;
  const byId = new Map(texts.map((t) => [t.id, t.text.trim()]));
  const copy = JSON.parse(JSON.stringify(src)) as BoardGroup;
  const group: BoardGroup = {
    ...copy, id: `fg-${copy.id}`, spanElements: [],
    boards: copy.boards.map(({ localized: _l, ...b }) => ({
      ...b, id: `fg-${b.id}`,
      elements: b.elements.map((e) => {
        const out = { ...e, id: `fg-${e.id}` } as ArtboardElement;
        const text = byId.get(e.id);
        if (text && out.type === "text") setContent(out as TextElementProps, text.slice(0, budget((out as TextElementProps).content ?? "")));
        return out;
      }),
    })),
  };
  return produce(doc, (d) => { d.groups.push(group as Draft<BoardGroup>); });
}

/** Sets base text for every element with that id, on every board of every size; chip ids set one chip. */
export function applyTexts(doc: ChitrapxDoc, texts: SlotText[]): ChitrapxDoc {
  const byId = new Map(texts.map((t) => [t.id, t.text]));
  return produce(doc, (d) => {
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      if (e.type === "chips") {
        const el = e as unknown as ChipsElementProps;
        const next = el.chips.map((c, i) => byId.get(chipId(el.id, i))?.trim().slice(0, CHIP_MAX_CHARS) || c);
        if (next.some((c, i) => c !== el.chips[i])) el.chips = next;
        continue;
      }
      const text = byId.get(e.id);
      if (text !== undefined && e.type === "text") setContent(e as TextElementProps, text.trim().slice(0, budget((e as TextElementProps).content ?? "")));
    }
  });
}

/** How a machine translation lands (SP11). */
export type TranslateApply = {
  /** The text each id had when the job read it. A slot whose text changed since is skipped: its translation is of old words. */
  sources?: Map<string, string>;
  /** The language `sources` was read from; the base when absent. */
  sourceLocale?: string;
  /** Replace translations a person wrote. Default: keep them. */
  overwriteManual?: boolean;
};

/**
 * Writes machine translations as locale overrides marked `origin: "auto"`, hashed against the base text, and adds
 * the language. A slot a person translated (content without `origin: "auto"`) is kept unless `overwriteManual`.
 */
export function applyTranslations(doc: ChitrapxDoc, locale: string, texts: SlotText[], opts: TranslateApply = {}): ChitrapxDoc {
  if (locale === doc.localization.baseLocale) return doc;
  const byId = new Map(texts.map((t) => [t.id, t.text.trim()]));
  const from = opts.sourceLocale && opts.sourceLocale !== doc.localization.baseLocale ? opts.sourceLocale : null;
  const changedSince = (id: string, now: string) => !!opts.sources?.has(id) && opts.sources.get(id) !== now;
  return produce(doc, (d) => {
    if (!d.localization.locales.some((l) => l.code === locale)) d.localization.locales.push({ code: locale });
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      const current = b.localized?.[locale]?.[e.id];
      const manual = (has: unknown) => has !== undefined && current?.origin !== "auto" && !opts.overwriteManual; // a person wrote this
      if (e.type === "chips") {
        const el = e as unknown as ChipsElementProps;
        const words = el.chips.map((_, i) => byId.get(chipId(el.id, i)));
        if (!words.some(Boolean)) continue;
        const src = from ? b.localized?.[from]?.[el.id]?.chips : undefined;
        if (el.chips.some((c, i) => changedSince(chipId(el.id, i), src?.[i] || c))) continue;
        if (manual(current?.chips)) {
          // A person typed some chips: keep those, and the list's manual mark and hash; AI words fill only the blanks.
          const typed = current!.chips!;
          const chips = normalizeChipOverride(el.chips.map((_, i) => typed[i] || words[i]?.slice(0, CHIP_MAX_CHARS) || ""), el.chips.length);
          if (chips && JSON.stringify(chips) !== JSON.stringify(typed)) b.localized![locale]![el.id] = { ...current, chips };
          continue;
        }
        const chips = normalizeChipOverride(words.map((w, i) => w?.slice(0, CHIP_MAX_CHARS) || current?.chips?.[i] || ""), el.chips.length);
        if (!chips) continue;
        ((b.localized ??= {})[locale] ??= {})[el.id] = { ...current, chips, origin: "auto", sourceHash: hash32(chipsSource(el.chips)) };
        continue;
      }
      const text = byId.get(e.id);
      if (text === undefined || e.type !== "text") continue;
      const base = (e as TextElementProps).content ?? "";
      if (changedSince(e.id, from ? (b.localized?.[from]?.[e.id]?.content || base) : base)) continue;
      if (manual(current?.content)) continue;
      const next = text.slice(0, budget(base));
      // The language's own marks were offsets into its old wording.
      const { marks: old, ...rest } = current ?? {};
      ((b.localized ??= {})[locale] ??= {})[e.id] = {
        ...rest, ...(current?.content === next && old ? { marks: old } : {}), content: next, origin: "auto", sourceHash: hash32(base),
      };
    }
  });
}
