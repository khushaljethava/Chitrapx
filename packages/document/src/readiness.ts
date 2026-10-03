import { lintBoard } from "./aso.ts";
import type { BoardGroup, ChitrapxDoc } from "./doc.ts";
import { resolveGroup, type ExportItem } from "./exportPlan.ts";
import { getTarget, type Platform, type TargetId } from "./targets.ts";

export type Store = "app-store" | "play";
export type ReadinessIssue = {
  store: Store; severity: "error" | "warning"; code: string; message: string;
  targetId?: TargetId; locale?: string; groupId?: string; boardIndex?: number;
};

/** Which store a size is uploaded to; social sizes go to neither. */
export function storeOf(platform: Platform): Store | null {
  if (platform === "android" || platform === "play") return "play";
  return platform === "social" ? null : "app-store";
}

const APP_STORE_MAX = 10;
const PLAY_PHONE = { min: 2, max: 8, promo: 4, promoSide: 1080 };
const PLAY_SIDE = { min: 320, max: 3840 };

function groupBy<K>(items: ExportItem[], key: (i: ExportItem) => K): Map<K, ExportItem[]> {
  const m = new Map<K, ExportItem[]>();
  for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
  return m;
}

/** Store rules for a planned export. Reported, never enforced. */
export function storeReadiness(plan: ExportItem[], doc: ChitrapxDoc): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  const tgt = (i: ExportItem) => getTarget(i.targetId)!;
  const slots = new Set(plan.map((i) => tgt(i).slot));
  const has = (p: Platform) => plan.some((i) => tgt(i).platform === p);

  // App Store
  if (has("ios") && !slots.has("ios-6.9") && !slots.has("ios-6.5")) {
    out.push({ store: "app-store", severity: "error", code: "iphone_slot_missing", message: 'Add an iPhone 6.9" or 6.5" size. App Store Connect needs one of them for iPhone apps.' });
  }
  if (has("ipad") && !slots.has("ipad-13")) {
    out.push({ store: "app-store", severity: "error", code: "ipad_slot_missing", message: 'Add an iPad 13" size. App Store Connect needs it for iPad apps.' });
  }
  const apple = plan.filter((i) => storeOf(tgt(i).platform) === "app-store");
  for (const items of groupBy(apple, (i) => `${i.targetId}|${i.locale}|${i.variant ?? ""}`).values()) {
    if (items.length <= APP_STORE_MAX) continue;
    const i = items[0]!;
    out.push({ store: "app-store", severity: "error", code: "count_out_of_range", targetId: i.targetId, locale: i.locale,
      message: `${tgt(i).label}${i.variant ? ` (variant ${i.variant})` : ""} in ${i.locale} has ${items.length} screenshots. App Store Connect takes up to ${APP_STORE_MAX}.` });
  }

  // Google Play
  const play = plan.filter((i) => storeOf(tgt(i).platform) === "play");
  const phones = play.filter((i) => tgt(i).slot === "android-phone" && !i.variant);
  for (const [locale, items] of groupBy(phones, (i) => i.locale)) {
    if (items.length < PLAY_PHONE.min || items.length > PLAY_PHONE.max) {
      out.push({ store: "play", severity: "error", code: "phone_count_out_of_range", locale, targetId: items[0]!.targetId,
        message: `Phone screenshots in ${locale}: ${items.length}. Google Play takes ${PLAY_PHONE.min} to ${PLAY_PHONE.max}.` });
    }
    const big = items.filter((i) => Math.min(i.width, i.height) >= PLAY_PHONE.promoSide).length;
    if (big < PLAY_PHONE.promo) {
      out.push({ store: "play", severity: "warning", code: "promo_ineligible", locale, targetId: items[0]!.targetId,
        message: `Phone screenshots in ${locale} at ${PLAY_PHONE.promoSide} px or more: ${big}. Google Play needs ${PLAY_PHONE.promo} for featuring and recommendations.` });
    }
  }
  if (play.length && !play.some((i) => i.targetId === "play-feature")) {
    out.push({ store: "play", severity: "error", code: "feature_graphic_missing", message: "Add the 1024×500 feature graphic. Google Play needs it to publish." });
  }
  for (const id of new Set(play.filter((i) => i.targetId !== "play-feature").map((i) => i.targetId))) {
    const t = getTarget(id)!;
    const lo = Math.min(t.width, t.height), hi = Math.max(t.width, t.height);
    if (lo < PLAY_SIDE.min || hi > PLAY_SIDE.max || hi > 2 * lo) {
      out.push({ store: "play", severity: "error", code: "dimension_out_of_range", targetId: id,
        message: `${t.label} is ${t.width}×${t.height}. Google Play needs each side from ${PLAY_SIDE.min} to ${PLAY_SIDE.max} px and the long side at most twice the short side.` });
    }
  }

  // Both stores, once per size
  const cache = new Map<string, BoardGroup>();
  for (const [id, items] of groupBy(plan, (i) => i.targetId)) {
    const t = getTarget(id)!;
    const store = storeOf(t.platform);
    if (!store) continue;
    const first = items[0]!;
    if (first.letterboxed) {
      const from = getTarget(doc.groups.find((g) => g.id === first.sourceGroupId)!.target)!;
      out.push({ store, severity: "warning", code: "letterboxed", targetId: id, groupId: first.sourceGroupId,
        message: `${t.label} is made from ${from.label} with empty bands around it. Add it as an editable size for a better fit.` });
    }
    let n = 0;
    let at: ExportItem | null = null;
    for (const i of items) {
      const b = resolveGroup(doc, i, cache).boards[i.boardIndex]!;
      const found = lintBoard(b, { code: i.locale, base: doc.localization.baseLocale }).length;
      if (found && !at) at = i;
      n += found;
    }
    if (at) {
      out.push({ store, severity: "warning", code: "design_issues", targetId: id, groupId: at.sourceGroupId, boardIndex: at.boardIndex, locale: at.locale,
        message: `${t.label}: ${n} design check${n === 1 ? "" : "s"} (headline length, contrast or text size).` });
    }
  }
  return out;
}
