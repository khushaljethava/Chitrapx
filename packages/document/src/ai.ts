import { produce } from "immer";
import { z } from "zod";
import type { ArtboardElement, TextElementProps } from "./artboard.ts";
import type { ChitrapxDoc } from "./doc.ts";
import { fillScreenshots } from "./fill.ts";
import { remapMarks } from "./richText.ts";

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
export type ScreenInsight = z.infer<typeof screenInsightSchema>;

export const templateChoiceSchema = z.object({
  templateSlug: z.string(),
  screenshotOrder: z.array(z.number().int()).describe("Screenshot indices in the order they should appear, best first"),
  reasoning: z.string(),
});
export type TemplateChoice = z.infer<typeof templateChoiceSchema>;

const slotText = z.object({ id: z.string(), text: z.string() });
export type SlotText = z.infer<typeof slotText>;

export const slotCopySchema = z.object({
  boards: z.array(z.object({ boardIndex: z.number().int(), texts: z.array(slotText) })),
});
export type SlotCopy = z.infer<typeof slotCopySchema>;

export const translationsSchema = z.object({ texts: z.array(slotText) });

export const TONES = ["confident", "warm", "punchy"] as const;
export const variantsSchema = z.object({
  variants: z.array(z.object({ tone: z.enum(TONES), texts: z.array(slotText) })),
});
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

/** Every distinct base text in the document (deduplicated by id across boards and sizes). */
export function allTexts(doc: ChitrapxDoc): SlotText[] {
  const seen = new Map<string, string>();
  for (const g of doc.groups) for (const b of g.boards) for (const e of b.elements) if (isText(e) && !seen.has(e.id)) seen.set(e.id, e.content ?? "");
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

/** Sets base text for every element with that id, on every board of every size. */
export function applyTexts(doc: ChitrapxDoc, texts: SlotText[]): ChitrapxDoc {
  const byId = new Map(texts.map((t) => [t.id, t.text]));
  return produce(doc, (d) => {
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      const text = byId.get(e.id);
      if (text !== undefined && e.type === "text") setContent(e as TextElementProps, text.trim().slice(0, budget((e as TextElementProps).content ?? "")));
    }
  });
}

/**
 * Writes machine translations as locale overrides marked `origin: "auto"` and adds the language.
 * A slot a person already translated (an override with content and no `origin: "auto"`) is kept.
 */
export function applyTranslations(doc: ChitrapxDoc, locale: string, texts: SlotText[], sources?: Map<string, string>): ChitrapxDoc {
  if (locale === doc.localization.baseLocale) return doc;
  const byId = new Map(texts.map((t) => [t.id, t.text.trim()]));
  return produce(doc, (d) => {
    if (!d.localization.locales.some((l) => l.code === locale)) d.localization.locales.push({ code: locale });
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      const text = byId.get(e.id);
      if (text === undefined || e.type !== "text") continue;
      const base = (e as TextElementProps).content ?? "";
      // The base text changed while the translation ran: this translation is of old words.
      if (sources && sources.has(e.id) && sources.get(e.id) !== base) continue;
      const byEl = ((b.localized ??= {})[locale] ??= {});
      const current = byEl[e.id];
      if (current?.content !== undefined && current.origin !== "auto") continue; // a person wrote this
      const next = text.slice(0, budget(base));
      // The language's own marks were offsets into its old wording.
      const { marks: _old, ...rest } = current ?? {};
      byEl[e.id] = { ...rest, ...(current?.content === next && _old ? { marks: _old } : {}), content: next, origin: "auto" };
    }
  });
}
