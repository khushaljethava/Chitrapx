import type { ArtboardElement } from "./artboard.ts";
import type { ChitrapxDoc } from "./doc.ts";
import { getTarget } from "./targets.ts";

export type ExportItem = {
  groupId: string; boardIndex: number; locale: string;
  /** Path inside the ZIP: <platform>/<target>/<locale>/<NN>-<board-name>.png */
  file: string;
  width: number; height: number;
  /** WebGL contexts this board needs (3D devices, including span elements crossing it). */
  threeD: number;
};

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "board";
const is3d = (el: ArtboardElement) => el.type === "device" && /^3d-/.test((el as { styleType?: string }).styleType ?? "");

/** One export may produce at most this many PNGs (boards x locales); keeps worker memory and time bounded. */
export const MAX_EXPORT_ITEMS = 200;

/** Every PNG an export produces, locale-major, in a stable order, at the target's exact pixel size. */
export function exportPlan(doc: ChitrapxDoc, locales?: string[]): ExportItem[] {
  const all = [...new Set([doc.localization.baseLocale, ...doc.localization.locales.map((l) => l.code)])];
  const chosen = locales?.length ? all.filter((l) => locales.includes(l)) : all;
  const items: ExportItem[] = [];
  for (const locale of chosen) for (const g of doc.groups) {
    const target = getTarget(g.target)!;
    const w = g.boards[0]?.size.width ?? target.width;
    g.boards.forEach((b, i) => {
      const spans = g.spanElements.filter((el) => is3d(el) && el.position.x < (i + 1) * w && el.position.x + el.size.width > i * w).length;
      items.push({
        groupId: g.id, boardIndex: i, locale,
        file: `${target.platform}/${target.id}/${locale}/${String(i + 1).padStart(2, "0")}-${slug(b.name || b.id)}.png`,
        width: target.width, height: target.height,
        threeD: b.elements.filter(is3d).length + spans,
      });
    });
  }
  return items;
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
export function checkExportable(doc: ChitrapxDoc, locales?: string[]):
  { ok: true; plan: ExportItem[] } | { ok: false; code: "board_size_mismatch" | "export_too_large" | "nothing_to_export" } {
  for (const g of doc.groups) {
    const t = getTarget(g.target)!;
    if (g.boards.some((b) => b.size.width !== t.width || b.size.height !== t.height)) return { ok: false, code: "board_size_mismatch" };
  }
  const plan = exportPlan(doc, locales);
  if (!plan.length) return { ok: false, code: "nothing_to_export" };
  if (plan.length > MAX_EXPORT_ITEMS) return { ok: false, code: "export_too_large" };
  return { ok: true, plan };
}
