import { z } from "zod";
import type { ArtboardElement } from "./artboard.ts";
import { LOCALE_CODE, type BoardGroup, type ChitrapxDoc } from "./doc.ts";
import { retarget } from "./retarget.ts";
import { getTarget, TARGET_IDS, TARGETS, type Platform, type TargetId } from "./targets.ts";

export type ExportSelection = {
  targets: TargetId[];
  locales: string[];
  /** Single-PNG export: exactly one board. */
  board?: { groupId: string; boardIndex: number };
};

export const exportSelectionSchema = z.object({
  targets: z.array(z.enum(TARGET_IDS)).min(1).max(TARGETS.length),
  locales: z.array(z.string().regex(LOCALE_CODE)).min(1).max(100),
  board: z.object({ groupId: z.string().min(1).max(100), boardIndex: z.number().int().min(0).max(999) }).optional(),
});

export type ExportItem = {
  targetId: TargetId;
  /** The group whose boards are drawn; for a derived item, retargeted to `targetId` by resolveGroup. */
  sourceGroupId: string;
  boardIndex: number;
  locale: string;
  /** A/B variant letter of the source group; never set on derived items. */
  variant?: string;
  /** Path inside the ZIP: <platform>/<target>[-variant]/<locale>/<NN>-<board-name>.png */
  file: string;
  width: number; height: number;
  /** Rendered from another size's group. */
  derived: boolean;
  /** Derived across more than LETTERBOX_TOLERANCE aspect difference: empty bands around the design. */
  letterboxed: boolean;
  /** WebGL contexts this board needs (3D devices, including span elements crossing it). */
  threeD: number;
};

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "board";
const is3d = (el: ArtboardElement) => el.type === "device" && /^3d-/.test((el as { styleType?: string }).styleType ?? "");

/** One export may produce at most this many PNGs (boards x locales); keeps worker memory and time bounded. */
export const MAX_EXPORT_ITEMS = 200;
/** Relative aspect-ratio difference above which a derived size counts as letterboxed. */
export const LETTERBOX_TOLERANCE = 0.05;

export const allLocales = (doc: ChitrapxDoc): string[] =>
  [...new Set([doc.localization.baseLocale, ...doc.localization.locales.map((l) => l.code)])];

/** What exports did before sizes could be chosen: every group's own size, every language. */
export function defaultSelection(doc: ChitrapxDoc): ExportSelection {
  return { targets: [...new Set(doc.groups.map((g) => g.target))], locales: allLocales(doc) };
}

const aspect = (g: BoardGroup) => g.boards[0]!.size.width / g.boards[0]!.size.height;

/** The groups that render `targetId`: its own (with A/B variants), or else the closest non-variant group. */
export function sourcesFor(doc: ChitrapxDoc, targetId: TargetId): { groups: BoardGroup[]; derived: boolean; letterboxed: boolean } {
  const target = getTarget(targetId)!;
  const own = doc.groups.filter((g) => g.target === targetId && g.boards.length);
  if (own.length) return { groups: own, derived: false, letterboxed: false };
  const r = target.width / target.height;
  const candidates = doc.groups.filter((g) => !g.variant && g.boards.length);
  const samePlatform = candidates.filter((g) => getTarget(g.target)?.platform === target.platform);
  const pool = samePlatform.length ? samePlatform : candidates;
  if (!pool.length) return { groups: [], derived: true, letterboxed: false };
  const off = (g: BoardGroup) => Math.abs(aspect(g) - r) / r;
  const best = pool.reduce((a, b) => (off(b) < off(a) ? b : a));
  return { groups: [best], derived: true, letterboxed: off(best) > LETTERBOX_TOLERANCE };
}

/** Every PNG an export produces, locale-major then in selection order, at the target's exact pixel size. */
export function exportPlan(doc: ChitrapxDoc, selection: ExportSelection = defaultSelection(doc)): ExportItem[] {
  const locales = allLocales(doc).filter((l) => selection.locales.includes(l));
  const items: ExportItem[] = [];
  for (const locale of locales) for (const targetId of new Set(selection.targets)) {
    const target = getTarget(targetId);
    if (!target) continue;
    const src = sourcesFor(doc, targetId);
    for (const g of src.groups) {
      const w = g.boards[0]!.size.width;
      g.boards.forEach((b, i) => {
        if (selection.board && (selection.board.groupId !== g.id || selection.board.boardIndex !== i)) return;
        const spans = g.spanElements.filter((el) => is3d(el) && el.position.x < (i + 1) * w && el.position.x + el.size.width > i * w).length;
        const variant = src.derived ? undefined : g.variant;
        items.push({
          targetId, sourceGroupId: g.id, boardIndex: i, locale, ...(variant ? { variant } : {}),
          file: `${target.platform}/${target.id}${variant ? `-${variant}` : ""}/${locale}/${String(i + 1).padStart(2, "0")}-${slug(b.name || b.id)}.png`,
          width: target.width, height: target.height,
          derived: src.derived, letterboxed: src.letterboxed,
          threeD: b.elements.filter(is3d).length + spans,
        });
      });
    }
  }
  return items;
}

/** The group an item is drawn from: the source itself, or (derived) the source retargeted in memory. */
export function resolveGroup(doc: ChitrapxDoc, item: ExportItem, cache?: Map<string, BoardGroup>): BoardGroup {
  const g = doc.groups.find((x) => x.id === item.sourceGroupId);
  if (!g) throw new Error(`no group ${item.sourceGroupId}`);
  if (!item.derived) return g;
  const key = `${g.id}>${item.targetId}`;
  let out = cache?.get(key);
  if (!out) { out = retarget(g, item.targetId); cache?.set(key, out); }
  return out;
}

/** Groups plan indices so no page holds more than `max3d` WebGL contexts (browsers keep about 16). */
export function exportBatches(plan: ExportItem[], max3d = 8): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let used = 0;
  plan.forEach((item, i) => {
    if (current.length && used + item.threeD > max3d) { batches.push(current); current = []; used = 0; }
    current.push(i);
    used += item.threeD;
  });
  if (current.length) batches.push(current);
  return batches;
}

/** Whether a document can be exported: every board at its target's size, and a bounded number of files. */
export function checkExportable(doc: ChitrapxDoc, selection?: ExportSelection):
  { ok: true; plan: ExportItem[] } | { ok: false; code: "board_size_mismatch" | "export_too_large" | "nothing_to_export" } {
  for (const g of doc.groups) {
    const t = getTarget(g.target)!;
    if (g.boards.some((b) => b.size.width !== t.width || b.size.height !== t.height)) return { ok: false, code: "board_size_mismatch" };
  }
  const plan = exportPlan(doc, selection);
  if (!plan.length) return { ok: false, code: "nothing_to_export" };
  if (plan.length > MAX_EXPORT_ITEMS) return { ok: false, code: "export_too_large" };
  return { ok: true, plan };
}

export type ExportPreset = "app-store" | "play" | "everything";
const APPLE: Platform[] = ["ios", "ipad", "mac", "watch", "tv", "vision", "preview"];

/** The project's own size in `slot` if it has one (no derive needed), else `fallback`. */
function inSlot(doc: ChitrapxDoc, slot: string, fallback: TargetId): TargetId {
  return doc.groups.find((g) => !g.variant && getTarget(g.target)?.slot === slot)?.target ?? fallback;
}
const platforms = (doc: ChitrapxDoc) => new Set(doc.groups.map((g) => getTarget(g.target)!.platform));

export function presetSelection(doc: ChitrapxDoc, preset: ExportPreset): ExportSelection {
  const locales = allLocales(doc);
  if (preset === "app-store") {
    const targets: TargetId[] = [inSlot(doc, "ios-6.9", "iphone-6.9-1320")];
    if (platforms(doc).has("ipad")) targets.push(inSlot(doc, "ipad-13", "ipad-13"));
    return { targets, locales };
  }
  if (preset === "play") return { targets: [inSlot(doc, "android-phone", "android-phone"), "play-feature"], locales };
  const mine = platforms(doc);
  return { targets: TARGETS.filter((t) => mine.has(t.platform)).map((t) => t.id), locales };
}

/** What the export dialog opens on when the project has never been exported. */
export function suggestedSelection(doc: ChitrapxDoc): ExportSelection {
  const mine = platforms(doc);
  const targets: TargetId[] = [];
  if ([...mine].some((p) => APPLE.includes(p))) targets.push(...presetSelection(doc, "app-store").targets);
  if (mine.has("android") || mine.has("play")) targets.push(...presetSelection(doc, "play").targets);
  return targets.length ? { targets: [...new Set(targets)], locales: allLocales(doc) } : presetSelection(doc, "everything");
}
