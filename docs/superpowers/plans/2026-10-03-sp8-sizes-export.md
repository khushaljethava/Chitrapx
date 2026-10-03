# Sub-project 8: Sizes and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every store size, one design exporting to any size, a free single-PNG download, a store-readiness report, and a portable `.chitrapx` project file.

**Architecture:** Pure planning lives in `packages/document` (`exportPlan`, `sourcesFor`, `resolveGroup`, `storeReadiness`, presets, bundle document rewriting) and is shared by the web dialog, the render page and the worker. Exports read a `project_versions` row pinned when the job is queued. New free jobs (`export_single`, `project_bundle`, `project_import`) run through the existing job path at price 0; the first two share a 30-per-hour limit.

**Tech Stack:** TypeScript, Next.js (apps/web), pg-boss worker (apps/worker), Drizzle + Postgres (packages/db), Playwright Chromium, sharp, fflate, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-sp8-sizes-export-design.md`

## Global Constraints

- Existing target ids and pixel sizes never change; saved projects keep working.
- `MAX_EXPORT_ITEMS = 200` per export; `exportBatches` unchanged.
- Letterboxed = derived and `|source aspect - target aspect| / target aspect > 0.05`.
- Prices: `export: 1`, `export_single: 0`, `project_bundle: 0`, `project_import: 0`.
- Free-job limit: 30 `export_single` + `project_bundle` jobs per workspace per rolling hour; over it HTTP 429 `rate_limited`, no job row. Message: "Free downloads are limited to 30 per hour." (the single-PNG UI appends " Use Export ZIP for full sets.").
- Every exported PNG is RGB without alpha (`flatten` onto `#ffffff`, `removeAlpha`).
- Play file limit 8 MB per PNG (`file_too_large`, error, reported, never blocking).
- Bundle limits: file ≤ 500 MB, ≤ 500 zip entries, ≤ 500 MB total uncompressed, each asset within `UPLOAD_LIMITS[kind]`, `doc.json` ≤ `MAX_DOC_BYTES` (5 MB).
- Bundle format `chitrapx-project`, version `1`; `doc.json` sources `bundle:<sha256>[#poster]`.
- Project-limit errors reuse `plan_limit` (HTTP 403 in the web app, job error `plan_limit` in the worker).
- Store rules report and never block an export.
- ZIP paths `<platform>/<target>[-variant]/<locale>/<NN>-<board-name>.png`; derived sizes never get a variant suffix.

## Review Focus

1. **Export queued just before deploy** (input `{ locales }`, no `versionId`): must still run against the live project with every group's own size. Pinned by the legacy `exportSource` test in Task 4.
2. **A/B variant groups must never be the source of a derived size**, or a B variant leaks into the 6.5" folder. Pinned in Task 2.
3. **A deleted asset still referenced by the document when downloading a project file** must fail with `asset_missing`, not produce a file that cannot be imported. Pinned in Task 9.
4. **Import racing the plan limit**: the worker re-checks under the workspace lock, so a free workspace at its limit gets `plan_limit` and no project. Pinned in Task 10.
5. **Editing then clicking Download PNG immediately**: the PNG must show what was on screen, so the button flushes autosave first and refuses when the save fails. Verified in Task 7 Step 6.

## File Structure

| File | Responsibility |
|---|---|
| `packages/document/src/targets.ts` (modify) | `slot` on every target, new sizes |
| `packages/document/src/exportPlan.ts` (modify) | selection, sources, plan, `resolveGroup`, presets, `exportSelectionSchema` |
| `packages/document/src/readiness.ts` (create) | `storeReadiness`, `storeOf` |
| `packages/document/src/bundle.ts` (create) | `asset:` <-> `bundle:` rewriting, manifest schema, bundle limits, `MAX_DOC_BYTES` |
| `packages/db/src/exportSource.ts` (create) | the pinned (or legacy) document and selection of an export job |
| `packages/db/src/assetCheck.ts` (create) | upload limits and byte sniffing shared by uploads and import |
| `packages/db/src/pricing.ts`, `credits.ts` (modify) | new job types, expiries |
| `apps/web/src/server/jobs.ts` (modify) | export/single/bundle enqueue, version pin, free quota, downloads |
| `apps/web/src/server/imports.ts` (create) | import sign + enqueue |
| `apps/web/src/app/render/[jobId]/page.tsx`, `components/RenderSheet.tsx` (modify) | render the pinned doc and derived groups |
| `apps/web/src/components/ExportDialog.tsx`, `useJobDownload.ts`, `BundleButton.tsx`, `ImportProjectButton.tsx` (create) | UI |
| `apps/web/src/components/ExportPanel.tsx` (modify) | opens the dialog on the dashboard |
| `apps/web/src/editor/save.ts`, `Editor.tsx`, `ui/Toolbar.tsx`, `ui/LeftPanel.tsx` (modify) | `flush`, dialog in the editor, Download PNG |
| `apps/worker/src/export.ts` (modify) | pinned doc, single PNG, flatten, report |
| `apps/worker/src/storeFiles.ts` (create) | `finishPng`, `reportText` |
| `apps/worker/src/bundle.ts` (create) | `packBundle`, `runBundle`, `runImport` |
| `apps/worker/src/boss.ts` (create) | the worker's one PgBoss instance (import queues recording conversions) |

---

### Task 1: Store sizes with slots

**Files:**
- Modify: `packages/document/src/targets.ts:4-35`
- Test: `packages/document/test/targets.test.ts` (create)

**Interfaces:**
- Produces: `Target = { id; platform: Platform; slot: string; label; width; height }`; new `TargetId`s `iphone-6.9-1320`, `iphone-6.5-1284`, `iphone-6.3-1206`, `iphone-6.1`, `ipad-11`, `android-tablet-7-land`, `android-tablet-10-land`, `apple-tv-4k`, `watch-s9`, `watch-s6`, `watch-s3`, `app-preview-landscape`.

- [ ] **Step 1: Check sizes and rules against the stores**

Open Apple's "Screenshot specifications" (developer.apple.com/help/app-store-connect/reference/screenshot-specifications), Apple's "App preview specifications", and Google's "Add preview assets to showcase your app" (support.google.com/googleplay/android-developer/answer/9866151). Confirm every row of spec section 1 and every rule of spec section 4. Where a store's current value differs, edit the spec and the numbers in this plan (Task 1 code and Task 3 constants), then `git commit -m "docs(spec): SP8 sizes and rules checked against store docs"`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/document/test/targets.test.ts
import { describe, expect, it } from "vitest";
import { getTarget, TARGETS, targetForSize } from "../src/index.ts";

describe("targets", () => {
  it("every target has a unique id and a slot", () => {
    expect(new Set(TARGETS.map((t) => t.id)).size).toBe(TARGETS.length);
    for (const t of TARGETS) expect(t.slot, t.id).toMatch(/^[a-z0-9.-]+$/);
  });

  it("adds the missing store sizes in their slots", () => {
    expect(getTarget("iphone-6.9-1320")).toMatchObject({ slot: "ios-6.9", width: 1320, height: 2868 });
    expect(getTarget("iphone-6.1")).toMatchObject({ slot: "ios-6.1", width: 1170, height: 2532 });
    expect(getTarget("ipad-11")).toMatchObject({ slot: "ipad-11", width: 1668, height: 2388 });
    expect(getTarget("android-tablet-10-land")).toMatchObject({ slot: "android-tablet-10", width: 2560, height: 1600 });
    expect(getTarget("apple-tv-4k")).toMatchObject({ slot: "tv", width: 3840, height: 2160 });
    expect(getTarget("watch-s3")).toMatchObject({ slot: "watch", width: 312, height: 390 });
    expect(getTarget("app-preview-landscape")).toMatchObject({ slot: "preview", width: 1920, height: 886 });
    expect(getTarget("ipad-12.9")!.slot).toBe("ipad-13");
  });

  it("keeps template boards on their existing target", () => {
    expect(targetForSize(1290, 2796).id).toBe("iphone-6.9");
    expect(targetForSize(1320, 2868).id).toBe("iphone-6.9-1320");
    expect(targetForSize(3840, 2160).id).toBe("vision-pro");
  });

  it("offers the 1320 px 6.9-inch size first", () => {
    expect(TARGETS[0]!.id).toBe("iphone-6.9-1320");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @chitrapx/document exec vitest run test/targets.test.ts`
Expected: FAIL (`slot` undefined, unknown ids).

- [ ] **Step 4: Implement**

Replace `targets.ts` lines 4–35 (from `export type Target` through the closing `] as const satisfies readonly Target[];`) with:

```ts
export type Target = { id: string; platform: Platform; slot: string; label: string; width: number; height: number };

const t = (id: string, platform: Platform, slot: string, label: string, width: number, height: number): Target =>
  ({ id, platform, slot, label, width, height });

/**
 * Order is the order sizes are offered in. `slot` is the place App Store Connect or Play accepts a
 * size; several sizes can fill one slot. vision-pro precedes apple-tv-4k (same pixels) so
 * targetForSize keeps mapping imported 3840x2160 templates to Vision Pro.
 */
export const TARGETS = [
  t("iphone-6.9-1320", "ios", "ios-6.9", 'iPhone 6.9" (1320×2868)', 1320, 2868),
  t("iphone-6.9", "ios", "ios-6.9", 'iPhone 6.9"', 1290, 2796),
  t("iphone-6.5-1284", "ios", "ios-6.5", 'iPhone 6.5" (1284×2778)', 1284, 2778),
  t("iphone-6.5", "ios", "ios-6.5", 'iPhone 6.5"', 1242, 2688),
  t("iphone-6.3-1206", "ios", "ios-6.3", 'iPhone 6.3" (1206×2622)', 1206, 2622),
  t("iphone-6.3", "ios", "ios-6.3", 'iPhone 6.3"', 1179, 2556),
  t("iphone-6.1", "ios", "ios-6.1", 'iPhone 6.1"', 1170, 2532),
  t("iphone-5.5", "ios", "ios-5.5", 'iPhone 5.5"', 1242, 2208),
  t("ipad-13", "ipad", "ipad-13", 'iPad 13"', 2064, 2752),
  t("ipad-12.9", "ipad", "ipad-13", 'iPad Pro 12.9"', 2048, 2732),
  t("ipad-11", "ipad", "ipad-11", 'iPad 11"', 1668, 2388),
  t("mac-2880", "mac", "mac", "Mac 2880x1800", 2880, 1800),
  t("mac-2560", "mac", "mac", "Mac 2560x1600", 2560, 1600),
  t("mac-1440", "mac", "mac", "Mac 1440x900", 1440, 900),
  t("mac-1280", "mac", "mac", "Mac 1280x800", 1280, 800),
  t("watch-ultra", "watch", "watch", "Apple Watch Ultra", 422, 514),
  t("watch-s10", "watch", "watch", "Apple Watch Series 10", 416, 496),
  t("watch-s9", "watch", "watch", "Apple Watch Series 9", 396, 484),
  t("watch-s6", "watch", "watch", "Apple Watch Series 6", 368, 448),
  t("watch-s3", "watch", "watch", "Apple Watch Series 3", 312, 390),
  t("vision-pro", "vision", "vision", "Apple Vision Pro", 3840, 2160),
  t("apple-tv-4k", "tv", "tv", "Apple TV 4K", 3840, 2160),
  t("apple-tv", "tv", "tv", "Apple TV", 1920, 1080),
  t("android-phone", "android", "android-phone", "Android phone", 1080, 1920),
  t("android-tablet-7", "android", "android-tablet-7", 'Android tablet 7"', 1200, 1920),
  t("android-tablet-7-land", "android", "android-tablet-7", 'Android tablet 7" landscape', 1920, 1200),
  t("android-tablet-10", "android", "android-tablet-10", 'Android tablet 10"', 1600, 2560),
  t("android-tablet-10-land", "android", "android-tablet-10", 'Android tablet 10" landscape', 2560, 1600),
  t("play-feature", "play", "play-feature", "Google Play feature graphic", 1024, 500),
  t("app-preview-portrait", "preview", "preview", "App Preview (portrait)", 886, 1920),
  t("app-preview-landscape", "preview", "preview", "App Preview (landscape)", 1920, 886),
  t("instagram-post", "social", "instagram-post", "Instagram post", 1080, 1350),
  t("instagram-story", "social", "instagram-story", "Instagram story", 1080, 1920),
  t("x-post", "social", "x-post", "X post", 1600, 900),
  t("linkedin-post", "social", "linkedin-post", "LinkedIn post", 1200, 627),
  t("product-hunt", "social", "product-hunt", "Product Hunt gallery", 1270, 760),
] as const satisfies readonly Target[];
```

- [ ] **Step 5: Run all document tests, regenerate the catalog**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/document exec tsx scripts/gen-catalog.ts && pnpm typecheck`
Expected: PASS. Commit any change `gen-catalog` makes to `packages/assets/catalog.json` with this task.

- [ ] **Step 6: Commit**

```bash
git add packages/document packages/assets/catalog.json
git commit -m "feat(document): store slots and the missing App Store and Play sizes"
```

---

### Task 2: Export selection, derived sizes and resolveGroup

**Files:**
- Modify: `packages/document/src/exportPlan.ts` (whole file)
- Modify: `apps/web/src/server/jobs.ts:5,36`, `apps/worker/src/export.ts:6,49`, `apps/web/src/app/render/[jobId]/page.tsx:4,42`, `apps/web/src/components/RenderSheet.tsx:4,15-19`
- Test: `packages/document/test/exportPlan.test.ts`

**Interfaces:**
- Consumes: `Target.slot`, `Platform`, `retarget(group, targetId)`, `LOCALE_CODE`.
- Produces:
  ```ts
  type ExportSelection = { targets: TargetId[]; locales: string[]; board?: { groupId: string; boardIndex: number } };
  type ExportItem = { targetId: TargetId; sourceGroupId: string; boardIndex: number; locale: string; variant?: string;
    file: string; width: number; height: number; derived: boolean; letterboxed: boolean; threeD: number };
  exportSelectionSchema
  LETTERBOX_TOLERANCE = 0.05
  allLocales(doc): string[]
  defaultSelection(doc): ExportSelection
  sourcesFor(doc, targetId): { groups: BoardGroup[]; derived: boolean; letterboxed: boolean }
  exportPlan(doc, selection?: ExportSelection): ExportItem[]
  resolveGroup(doc, item, cache?: Map<string, BoardGroup>): BoardGroup
  checkExportable(doc, selection?: ExportSelection)
  type ExportPreset = "app-store" | "play" | "everything"
  presetSelection(doc, preset): ExportSelection
  suggestedSelection(doc): ExportSelection
  ```

- [ ] **Step 1: Update the existing tests and add new ones**

In `packages/document/test/exportPlan.test.ts`:
- Import line becomes `import { defaultSelection, exportBatches, exportPlan, presetSelection, resolveGroup, retarget, sourcesFor, suggestedSelection } from "../src/index.ts";`
- `expect(plan[0]).toMatchObject({ groupId: "g1", boardIndex: 0, locale: "en-US", width: 1290, height: 2796 });` becomes `expect(plan[0]).toMatchObject({ sourceGroupId: "g1", targetId: "iphone-6.9", derived: false, letterboxed: false, boardIndex: 0, locale: "en-US", width: 1290, height: 2796 });`
- `exportPlan(d, ["fr-FR", "xx-XX"])` becomes `exportPlan(d, { ...defaultSelection(d), locales: ["fr-FR", "xx-XX"] })`

Append:

```ts
const android = (boards = [board("a1", [], 1080, 1920)]) => ({ id: "g2", target: "android-phone" as const, boards, spanElements: [] });

describe("derived sizes", () => {
  const d = doc([group([board("b1", []), board("b2", [])])]);

  it("renders a size with no group from the same-platform group, not letterboxed within 5%", () => {
    const plan = exportPlan(d, { targets: ["iphone-6.5"], locales: ["en-US"] });
    expect(plan.map((p) => p.file)).toEqual(["ios/iphone-6.5/en-US/01-b1.png", "ios/iphone-6.5/en-US/02-b2.png"]);
    expect(plan[0]).toMatchObject({ sourceGroupId: "g1", derived: true, letterboxed: false, width: 1242, height: 2688 });
  });

  it("marks a derived size letterboxed beyond 5% aspect difference, on any platform", () => {
    expect(exportPlan(d, { targets: ["iphone-5.5"], locales: ["en-US"] })[0]).toMatchObject({ derived: true, letterboxed: true });
    expect(exportPlan(d, { targets: ["android-phone"], locales: ["en-US"] })[0])
      .toMatchObject({ sourceGroupId: "g1", file: "android/android-phone/en-US/01-b1.png", derived: true, letterboxed: true });
  });

  it("prefers a group on the same platform", () => {
    const two = doc([group([board("b1", [])]), android()]);
    expect(sourcesFor(two, "android-tablet-7").groups.map((g) => g.id)).toEqual(["g2"]);
  });

  it("never derives from an A/B variant group", () => {
    const withVariant = doc([group([board("b1", [])]), { ...group([board("v1", [])]), id: "gB", variant: "B" }]);
    const plan = exportPlan(withVariant, { targets: ["iphone-6.5"], locales: ["en-US"] });
    expect(plan.map((p) => [p.sourceGroupId, p.file])).toEqual([["g1", "ios/iphone-6.5/en-US/01-b1.png"]]);
  });

  it("returns nothing for a size when the project has no boards", () => {
    expect(exportPlan(doc([]), { targets: ["iphone-6.5"], locales: ["en-US"] })).toEqual([]);
  });

  it("limits to one board for a single-PNG export", () => {
    const plan = exportPlan(d, { targets: ["iphone-6.9"], locales: ["en-US"], board: { groupId: "g1", boardIndex: 1 } });
    expect(plan.map((p) => p.file)).toEqual(["ios/iphone-6.9/en-US/02-b2.png"]);
  });

  it("resolveGroup returns the group itself, or its retargeted copy for derived items, cached", () => {
    const own = exportPlan(d)[0]!;
    expect(resolveGroup(d, own)).toBe(d.groups[0]);
    const derived = exportPlan(d, { targets: ["iphone-6.5"], locales: ["en-US"] })[0]!;
    const cache = new Map();
    expect(resolveGroup(d, derived, cache)).toEqual(retarget(d.groups[0]!, "iphone-6.5"));
    expect(resolveGroup(d, derived, cache)).toBe(resolveGroup(d, derived, cache));
  });
});

describe("presets", () => {
  const ios = doc([group([board("b1", [])])]);
  it("App Store required picks the 6.9-inch size the project designed, else the 1320 px one", () => {
    expect(presetSelection(ios, "app-store").targets).toEqual(["iphone-6.9"]);
    expect(presetSelection(doc([android()]), "app-store").targets).toEqual(["iphone-6.9-1320"]);
  });
  it("App Store required adds iPad 13 only when the project has iPad", () => {
    const withIpad = doc([group([board("b1", [])]), { id: "g3", target: "ipad-12.9", boards: [board("i1", [], 2048, 2732)], spanElements: [] }]);
    expect(presetSelection(withIpad, "app-store").targets).toEqual(["iphone-6.9", "ipad-12.9"]);
  });
  it("Play required is phone and feature graphic", () => {
    expect(presetSelection(ios, "play").targets).toEqual(["android-phone", "play-feature"]);
  });
  it("Everything is every size on the project's platforms", () => {
    const t = presetSelection(ios, "everything").targets;
    expect(t).toContain("iphone-6.1");
    expect(t.some((x) => x.startsWith("android"))).toBe(false);
  });
  it("suggests the required sets for the project's platforms, all languages", () => {
    const both = { ...doc([group([board("b1", [])]), android()]), localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] } };
    expect(suggestedSelection(both)).toEqual({ targets: ["iphone-6.9", "android-phone", "play-feature"], locales: ["en-US", "de-DE"] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chitrapx/document exec vitest run test/exportPlan.test.ts`
Expected: FAIL (`defaultSelection` is not exported; `sourceGroupId` missing).

- [ ] **Step 3: Rewrite `packages/document/src/exportPlan.ts`**

```ts
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
```

- [ ] **Step 4: Update callers to compile against the new API (behaviour unchanged)**

`apps/web/src/server/jobs.ts`: add `defaultSelection` to the `@chitrapx/document` import; line 36 becomes:
```ts
  const check = checkExportable(project.doc, locales ? { ...defaultSelection(project.doc), locales } : undefined);
```
`apps/worker/src/export.ts`: add `defaultSelection` to the `@chitrapx/document` import; line 49 becomes:
```ts
  const doc = migrate(project.doc);
  const locales = (input as { locales?: string[] } | null)?.locales;
  const check = checkExportable(doc, locales?.length ? { ...defaultSelection(doc), locales } : undefined);
```
`apps/web/src/app/render/[jobId]/page.tsx`: add `defaultSelection` to the import; line 42 becomes:
```ts
  const locales = (job.input as { locales?: string[] }).locales;
  const plan = exportPlan(doc, locales?.length ? { ...defaultSelection(doc), locales } : undefined);
```
`apps/web/src/components/RenderSheet.tsx`: change the import to `import { resolveGroup, type ChitrapxDoc, type ExportItem } from "@chitrapx/document";` and replace the `boards` memo:
```ts
  const boards = useMemo(() => {
    const cache = new Map();
    return indices.map((i) => {
      const item = plan[i]!;
      // A derived size draws its source group retargeted in memory; the saved document never changes.
      const g = resolveGroup(doc, item, cache);
      // Only this workspace's signed assets: the worker's browser must never fetch a URL a document names (SSRF).
      return { i, ...boardFor({ ...doc, groups: [g] }, g.id, item.boardIndex, item.locale, (src) => assetUrls[src] ?? null) };
    });
  }, [doc, plan, indices, assetUrls]);
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm --filter @chitrapx/document test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/document apps/web/src apps/worker/src
git commit -m "feat(document): export selection with derived sizes, presets and resolveGroup"
```

---

### Task 3: Store readiness

**Files:**
- Create: `packages/document/src/readiness.ts`
- Modify: `packages/document/src/index.ts`
- Test: `packages/document/test/readiness.test.ts`

**Interfaces:**
- Consumes: `ExportItem`, `resolveGroup`, `lintBoard(board, { code, base })`, `getTarget`.
- Produces:
  ```ts
  type Store = "app-store" | "play";
  type ReadinessIssue = { store: Store; severity: "error" | "warning"; code: string; message: string;
    targetId?: TargetId; locale?: string; groupId?: string; boardIndex?: number };
  storeOf(platform: Platform): Store | null
  storeReadiness(plan: ExportItem[], doc: ChitrapxDoc): ReadinessIssue[]
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/document/test/readiness.test.ts
import { describe, expect, it } from "vitest";
import { exportPlan, storeReadiness, type ChitrapxDoc, type ExportSelection } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const boards = (n: number, w = 1290, h = 2796) => Array.from({ length: n }, (_, i) => board(`b${i}`, [], w, h));
const codes = (d: ChitrapxDoc, sel: ExportSelection) => storeReadiness(exportPlan(d, sel), d).map((i) => `${i.severity}:${i.code}`);
const en = ["en-US"];

describe("storeReadiness: App Store", () => {
  it("passes a 6.9-inch set of 5", () => {
    expect(codes(doc([group(boards(5))]), { targets: ["iphone-6.9"], locales: en })).toEqual([]);
  });
  it("needs the 6.9 or 6.5 slot when any iPhone size is exported", () => {
    expect(codes(doc([group(boards(3))]), { targets: ["iphone-6.1"], locales: en })).toContain("error:iphone_slot_missing");
    expect(codes(doc([group(boards(3))]), { targets: ["iphone-6.5", "iphone-6.1"], locales: en })).not.toContain("error:iphone_slot_missing");
  });
  it("needs the 13-inch iPad slot when any iPad size is exported", () => {
    const d = doc([{ id: "i", target: "ipad-11", boards: boards(3, 1668, 2388), spanElements: [] }]);
    expect(codes(d, { targets: ["ipad-11"], locales: en })).toContain("error:ipad_slot_missing");
    expect(codes(d, { targets: ["ipad-11", "ipad-13"], locales: en })).not.toContain("error:ipad_slot_missing");
  });
  it("flags more than 10 screenshots per size", () => {
    expect(codes(doc([group(boards(11))]), { targets: ["iphone-6.9"], locales: en })).toContain("error:count_out_of_range");
    expect(codes(doc([group(boards(10))]), { targets: ["iphone-6.9"], locales: en })).not.toContain("error:count_out_of_range");
  });
});

describe("storeReadiness: Google Play", () => {
  const phone = (n: number) => ({ id: "a", target: "android-phone" as const, boards: boards(n, 1080, 1920), spanElements: [] });
  const feature = { id: "f", target: "play-feature" as const, boards: boards(1, 1024, 500), spanElements: [] };
  const both = { targets: ["android-phone", "play-feature"] as ExportSelection["targets"], locales: en };
  it("passes 4 phone shots and a feature graphic", () => {
    expect(codes(doc([phone(4), feature]), both)).toEqual([]);
  });
  it("needs 2 to 8 phone screenshots per language", () => {
    expect(codes(doc([phone(1), feature]), both)).toContain("error:phone_count_out_of_range");
    expect(codes(doc([phone(9), feature]), both)).toContain("error:phone_count_out_of_range");
  });
  it("needs a feature graphic", () => {
    expect(codes(doc([phone(4)]), { targets: ["android-phone"], locales: en })).toContain("error:feature_graphic_missing");
  });
  it("warns below 4 phone screenshots (featuring eligibility)", () => {
    expect(codes(doc([phone(3), feature]), both)).toContain("warning:promo_ineligible");
  });
  it("checks screenshot sides but not the feature graphic's 2.05 ratio", () => {
    expect(codes(doc([phone(4), feature]), both)).not.toContain("error:dimension_out_of_range");
  });
});

describe("storeReadiness: both stores", () => {
  it("warns once per letterboxed size", () => {
    const d = doc([group(boards(3))]);
    const issues = storeReadiness(exportPlan(d, { targets: ["iphone-6.9", "iphone-5.5"], locales: en }), d);
    expect(issues.filter((i) => i.code === "letterboxed")).toEqual([expect.objectContaining({ targetId: "iphone-5.5", severity: "warning", store: "app-store" })]);
  });
  it("totals design checks per size and points at the first board with one", () => {
    const longHeadline = { ...text("t", 0, 0), content: "one two three four five six seven" } as never;
    const d = doc([group([board("b0", [longHeadline]), ...boards(2)])]);
    const design = storeReadiness(exportPlan(d, { targets: ["iphone-6.9"], locales: en }), d).filter((i) => i.code === "design_issues");
    expect(design).toEqual([expect.objectContaining({ targetId: "iphone-6.9", groupId: "g1", boardIndex: 0 })]);
  });
  it("ignores social sizes", () => {
    const d = doc([{ id: "s", target: "x-post", boards: boards(1, 1600, 900), spanElements: [] }]);
    expect(codes(d, { targets: ["x-post"], locales: en })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/document exec vitest run test/readiness.test.ts`
Expected: FAIL (`storeReadiness` not exported).

- [ ] **Step 3: Implement `packages/document/src/readiness.ts`**

```ts
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
```

Add `export * from "./readiness.ts";` to `packages/document/src/index.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @chitrapx/document test`
Expected: PASS. If the `design_issues` test finds no issue, read `packages/document/src/aso.ts:104-160` and change the fixture text to the smallest content that trips `headline_words` (more than `MAX_HEADLINE_WORDS = 5` words is the rule there).

- [ ] **Step 5: Commit**

```bash
git add packages/document
git commit -m "feat(document): storeReadiness for App Store and Google Play rules"
```

---

### Task 4: Pinned document for exports

**Files:**
- Create: `packages/db/src/exportSource.ts`
- Modify: `packages/db/src/index.ts`, `apps/web/src/server/jobs.ts:11-38`, `apps/web/src/app/render/[jobId]/page.tsx`, `apps/worker/src/export.ts:43-52`, `apps/web/src/components/ExportPanel.tsx:23`
- Test: `apps/web/test/jobs.test.ts`

**Interfaces:**
- Consumes: `exportSelectionSchema`, `defaultSelection`, `checkExportable`, `allLocales`.
- Produces:
  ```ts
  // @chitrapx/db
  exportSource(job: { workspaceId: string; projectId: string | null; input: unknown }):
    Promise<{ doc: ChitrapxDoc; selection: ExportSelection } | null>
  // apps/web/src/server/jobs.ts
  pinVersion(tx: Tx, ctx: Ctx, project: { id: string; revision: number; doc: ChitrapxDoc }): Promise<string>
  enqueueExport(ctx, boss, projectId, raw: { kind?: "zip"; selection?: ExportSelection })
  // input of an "export" job: { selection: ExportSelection; versionId: string }
  JobSummary now includes `input`
  ```

- [ ] **Step 1: Write failing tests**

In `apps/web/test/jobs.test.ts`: add `exportSource` to the `@chitrapx/db` import, `import { defaultSelection } from "@chitrapx/document";`, `import { ZodError } from "zod";`. Change the existing export test's calls: `enqueueExport(ctx, boss, blank.id, {})` and `enqueueExport(ctx, boss, p.id, {})` become `{ kind: "zip" }`; `{ locales: ["xx-XX"] }` becomes `{ kind: "zip", selection: { targets: ["iphone-6.9"], locales: ["xx-XX"] } }`. Append:

```ts
describe("pinned exports", () => {
  async function templateProject(credits = 5) {
    await seedTemplates();
    const ctx = await ctxWith(credits);
    const app = await createApp(ctx, { name: "A" });
    return { ctx, p: await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" }) };
  }
  const jobById = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

  it("queues a ZIP against a version of the current revision, reused by the next export", async () => {
    const { ctx, p } = await templateProject();
    const a = await jobById((await enqueueExport(ctx, boss, p.id, { kind: "zip" })).jobId);
    const b = await jobById((await enqueueExport(ctx, boss, p.id, { kind: "zip", selection: { targets: ["iphone-6.5"], locales: ["en-US"] } })).jobId);
    const ia = a.input as { versionId: string };
    const ib = b.input as { versionId: string; selection: unknown };
    expect(ia.versionId).toBe(ib.versionId);
    expect(ib.selection).toEqual({ targets: ["iphone-6.5"], locales: ["en-US"] });
    expect(await db.select().from(schema.projectVersions).where(eq(schema.projectVersions.projectId, p.id))).toHaveLength(1);
  });

  it("exportSource reads the pinned version, not later edits", async () => {
    const { ctx, p } = await templateProject();
    const job = await jobById((await enqueueExport(ctx, boss, p.id, { kind: "zip" })).jobId);
    await db.update(schema.projects).set({ doc: { ...(p.doc as object), groups: [] }, revision: 99 }).where(eq(schema.projects.id, p.id));
    expect((await exportSource(job))!.doc.groups.length).toBeGreaterThan(0);
  });

  it("exportSource runs a job queued before pinning against the live project with every group's own size", async () => {
    const { ctx, p } = await templateProject();
    const src = await exportSource({ workspaceId: ctx.workspaceId, projectId: p.id, input: { locales: ["en-US"] } });
    expect(src!.selection).toEqual({ ...defaultSelection(src!.doc), locales: ["en-US"] });
    expect(await exportSource({ workspaceId: ctx.workspaceId, projectId: crypto.randomUUID(), input: {} })).toBeNull();
  });

  it("rejects unknown languages and sizes", async () => {
    const { ctx, p } = await templateProject();
    await expect(enqueueExport(ctx, boss, p.id, { kind: "zip", selection: { targets: ["iphone-6.9"], locales: ["xx-XX"] } })).rejects.toMatchObject({ code: "unknown_locale" });
    await expect(enqueueExport(ctx, boss, p.id, { kind: "zip", selection: { targets: ["nope"], locales: ["en-US"] } })).rejects.toBeInstanceOf(ZodError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm db:start && pnpm --filter @chitrapx/web exec vitest run test/jobs.test.ts`
Expected: FAIL (`exportSource` is not exported; input has no `versionId`).

- [ ] **Step 3: Implement `packages/db/src/exportSource.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { defaultSelection, exportSelectionSchema, migrate, type ChitrapxDoc, type ExportSelection } from "@chitrapx/document";
import { db, schema } from "./client.ts";

/**
 * The document and sizes an export job renders. Worker and render page both call this, so they
 * always plan the same items. Null when the pinned version or the project no longer exists.
 */
export async function exportSource(job: { workspaceId: string; projectId: string | null; input: unknown }):
  Promise<{ doc: ChitrapxDoc; selection: ExportSelection } | null> {
  const input = (job.input ?? {}) as { versionId?: string; selection?: unknown; locales?: string[] };
  if (input.versionId) {
    const [v] = await db.select({ doc: schema.projectVersions.doc }).from(schema.projectVersions)
      .where(and(eq(schema.projectVersions.id, input.versionId), eq(schema.projectVersions.workspaceId, job.workspaceId)));
    return v ? { doc: migrate(v.doc), selection: exportSelectionSchema.parse(input.selection) } : null;
  }
  // Queued before exports were pinned: the live project, every group's own size.
  if (!job.projectId) return null;
  const [p] = await db.select({ doc: schema.projects.doc }).from(schema.projects)
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!p) return null;
  const doc = migrate(p.doc);
  const selection = defaultSelection(doc);
  return { doc, selection: input.locales?.length ? { ...selection, locales: input.locales } : selection };
}
```

Add `export * from "./exportSource.ts";` to `packages/db/src/index.ts`.

- [ ] **Step 4: Enqueue with the pin** (`apps/web/src/server/jobs.ts`)

Add `input: schema.jobs.input,` to both `select({...})` column lists (in `listJobs` and `getJob`) and `"input"` to the `JobSummary` `Pick`. Imports: `type Tx` from `@chitrapx/db`; `allLocales, checkExportable, defaultSelection, exportSelectionSchema, LOCALE_CODE, VIDEO_FORMAT_IDS, type ChitrapxDoc` from `@chitrapx/document`. Replace `exportInput` and `enqueueExport`:

```ts
const exportBody = z.object({ kind: z.literal("zip").default("zip"), selection: exportSelectionSchema.optional() });

/** The version row exports read, so later edits never change a queued export. One per revision. */
export async function pinVersion(tx: Tx, ctx: Ctx, project: { id: string; revision: number; doc: ChitrapxDoc }): Promise<string> {
  const [v] = await tx.db.select({ id: schema.projectVersions.id }).from(schema.projectVersions)
    .where(and(eq(schema.projectVersions.projectId, project.id), eq(schema.projectVersions.workspaceId, ctx.workspaceId),
      eq(schema.projectVersions.revision, project.revision)))
    .limit(1);
  if (v) return v.id;
  const [ins] = await tx.db.insert(schema.projectVersions).values({
    workspaceId: ctx.workspaceId, projectId: project.id, revision: project.revision, doc: project.doc, label: "export", createdBy: ctx.userId,
  }).returning({ id: schema.projectVersions.id });
  return ins!.id;
}

/** Charges 1 credit and queues a ZIP of the chosen sizes and languages (every group's own size and every language by default). */
export async function enqueueExport(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown): Promise<{ jobId: string }> {
  const project = await getProject(ctx, projectId);
  const body = exportBody.parse(raw ?? {});
  if (!project.doc.groups.some((g) => g.boards.length)) throw badRequest("project_is_empty");
  const selection = body.selection ?? defaultSelection(project.doc);
  if (selection.locales.some((l) => !allLocales(project.doc).includes(l))) throw badRequest("unknown_locale");
  await requireRecordingsReady(ctx, project.doc);
  const check = checkExportable(project.doc, selection);
  if (!check.ok) throw badRequest(check.code);
  return withTx(async (tx) => {
    const versionId = await pinVersion(tx, ctx, project);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type: "export", input: { selection, versionId } });
  });
}
```

- [ ] **Step 5: Render page and worker read `exportSource`**

`apps/web/src/app/render/[jobId]/page.tsx` — imports: `exportSource` from `@chitrapx/db`; drop `defaultSelection` (added in Task 2). After the `job` lookup and `if (!job?.projectId) notFound();`, keep the existing project load + `migrate` only inside the `if (job.type === "video")` branch, and make the export path:

```ts
  const src = await exportSource(job);
  if (!src) notFound();
  const plan = exportPlan(src.doc, src.selection);
  const wanted = (items ?? "").split(",").filter(Boolean).map(Number).filter((i) => Number.isInteger(i) && plan[i]);
  const jobCtx = { userId: "", workspaceId: job.workspaceId, plan: "free" as const };
  const assetUrls = await assetUrlMap(jobCtx, supabaseStorage(), src.doc);
  return <RenderSheet doc={src.doc} plan={plan} indices={wanted.length ? wanted : plan.map((_, i) => i)} assetUrls={assetUrls} />;
```

`apps/worker/src/export.ts` `runExport` — replace from `if (!job.projectId)` through `const plan = check.plan;` with:

```ts
  const src = await exportSource({ workspaceId: job.workspaceId, projectId: job.projectId, input });
  if (!src) throw new FatalJobError("project_missing");
  const check = checkExportable(src.doc, src.selection);
  if (!check.ok) throw new FatalJobError(check.code);
  const plan = check.plan;
```

Import `exportSource` from `@chitrapx/db`; remove imports lint reports unused (`and`, `eq`, `migrate`, `defaultSelection`).

`apps/web/src/components/ExportPanel.tsx` line 23: post `{ kind: "zip" }` instead of `{}`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @chitrapx/web exec vitest run test/jobs.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/web apps/worker
git commit -m "fix(export): render a version pinned at enqueue so edits during an export cannot mix boards"
```

---

### Task 5: Free single-PNG export with an hourly limit

**Files:**
- Modify: `packages/db/src/pricing.ts`, `packages/db/src/credits.ts:11`, `apps/web/src/server/jobs.ts`, `apps/web/src/app/api/projects/[projectId]/export/route.ts`, `apps/web/src/app/render/[jobId]/page.tsx:26`, `apps/worker/src/export.ts`, `apps/worker/src/handlers.ts`
- Test: `apps/web/test/jobs.test.ts`

**Interfaces:**
- Consumes: `pinVersion`, `exportSource`, `ExportSelection.board`.
- Produces:
  ```ts
  PRICES.export_single = 0; PRICES.project_bundle = 0; PRICES.project_import = 0
  FREE_JOBS_PER_HOUR = 30
  assertFreeQuota(tx: Tx, workspaceId: string): Promise<void>   // HttpError 429 rate_limited
  enqueueExport(..., { kind: "single", groupId, boardIndex, locale })   // job type export_single, input { selection, versionId }
  runExport(input, job, kind: "zip" | "single" = "zip")
  DOWNLOAD_EXT = { export: "zip", export_single: "png", video: "mp4", project_bundle: "chitrapx" }
  ```

- [ ] **Step 1: Write failing tests** (append to `apps/web/test/jobs.test.ts`; in `beforeAll` add `await boss.createQueue("export_single");`; add `getProject` to the `@/server/projects.ts` import)

```ts
describe("single PNG", () => {
  async function project(credits = 0) {
    await seedTemplates();
    const ctx = await ctxWith(credits);
    const app = await createApp(ctx, { name: "A" });
    const p = await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" });
    return { ctx, p: await getProject(ctx, p.id) };
  }
  const single = (p: Awaited<ReturnType<typeof project>>["p"], boardIndex = 0) =>
    ({ kind: "single", groupId: p.doc.groups[0]!.id, boardIndex, locale: "en-US" });

  it("costs nothing and pins one board", async () => {
    const { ctx, p } = await project(0);
    const g = p.doc.groups[0]!;
    const { jobId } = await enqueueExport(ctx, boss, p.id, single(p, 1));
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job).toMatchObject({ type: "export_single", creditsReserved: 0 });
    expect((job!.input as { selection: unknown }).selection).toEqual({ targets: [g.target], locales: ["en-US"], board: { groupId: g.id, boardIndex: 1 } });
    expect(await balance(db, ctx.workspaceId)).toBe(0);
  });

  it("rejects a board that does not exist", async () => {
    const { ctx, p } = await project();
    await expect(enqueueExport(ctx, boss, p.id, single(p, 999))).rejects.toMatchObject({ status: 400, code: "unknown_board" });
  });

  it("allows 30 free jobs per hour, then 429 without a job row", async () => {
    const { ctx, p } = await project();
    await db.insert(schema.jobs).values(Array.from({ length: 30 }, () => ({ workspaceId: ctx.workspaceId, type: "export_single", creditsReserved: 0 })));
    const before = (await listJobs(ctx, { limit: 100 })).length;
    await expect(enqueueExport(ctx, boss, p.id, single(p))).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect((await listJobs(ctx, { limit: 100 })).length).toBe(before);
  });

  it("does not count jobs older than an hour", async () => {
    const { ctx, p } = await project();
    const old = new Date(Date.now() - 61 * 60_000);
    await db.insert(schema.jobs).values(Array.from({ length: 30 }, () => ({ workspaceId: ctx.workspaceId, type: "export_single", creditsReserved: 0, createdAt: old })));
    await expect(enqueueExport(ctx, boss, p.id, single(p))).resolves.toHaveProperty("jobId");
  });

  it("rejects an unknown kind", async () => {
    const { ctx, p } = await project();
    await expect(enqueueExport(ctx, boss, p.id, { kind: "gif" })).rejects.toBeInstanceOf(ZodError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/web exec vitest run test/jobs.test.ts`
Expected: FAIL (`kind: "single"` rejected).

- [ ] **Step 3: Prices and expiry**

`packages/db/src/pricing.ts`, inside `PRICES` after `process_recording`:
```ts
  /** One board as a PNG. Free, limited per hour (FREE_JOBS_PER_HOUR in the web app). */
  export_single: 0,
  /** Download the project as a .chitrapx file. Free, limited per hour. */
  project_bundle: 0,
  /** Create a project from a .chitrapx file. Free. */
  project_import: 0,
```
`packages/db/src/credits.ts` `EXPIRE_SECONDS`: add `export_single: 600, project_bundle: 1800, project_import: 1800`.

- [ ] **Step 4: Enqueue and download** (`apps/web/src/server/jobs.ts`)

Imports: add `count, gt, sql` to `drizzle-orm`; `lockWorkspace` to `@chitrapx/db`; `type ExportSelection` to `@chitrapx/document`. Replace `exportBody` and `enqueueExport` from Task 4:

```ts
const exportBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("zip"), selection: exportSelectionSchema.optional() }),
  z.object({ kind: z.literal("single"), groupId: z.string().min(1).max(100), boardIndex: z.number().int().min(0), locale: z.string().regex(LOCALE_CODE) }),
]);

export const FREE_JOBS_PER_HOUR = 30;
const FREE_JOBS = ["export_single", "project_bundle"];

/** Free downloads share an hourly allowance per workspace. Call inside the enqueue transaction. */
export async function assertFreeQuota(tx: Tx, workspaceId: string): Promise<void> {
  await lockWorkspace(tx.db, workspaceId);
  const [{ n }] = (await tx.db.select({ n: count() }).from(schema.jobs).where(and(
    eq(schema.jobs.workspaceId, workspaceId), inArray(schema.jobs.type, FREE_JOBS),
    gt(schema.jobs.createdAt, sql`now() - interval '1 hour'`),
  ))) as [{ n: number }];
  if (n >= FREE_JOBS_PER_HOUR) throw new HttpError(429, "rate_limited", `Free downloads are limited to ${FREE_JOBS_PER_HOUR} per hour.`);
}

/** A ZIP of chosen sizes and languages (1 credit), or one board as a PNG (free, limited per hour). */
export async function enqueueExport(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown): Promise<{ jobId: string }> {
  const project = await getProject(ctx, projectId);
  const body = exportBody.parse(raw ?? { kind: "zip" });
  if (!project.doc.groups.some((g) => g.boards.length)) throw badRequest("project_is_empty");
  let selection: ExportSelection;
  if (body.kind === "single") {
    const g = project.doc.groups.find((x) => x.id === body.groupId);
    if (!g?.boards[body.boardIndex]) throw badRequest("unknown_board");
    selection = { targets: [g.target], locales: [body.locale], board: { groupId: g.id, boardIndex: body.boardIndex } };
  } else selection = body.selection ?? defaultSelection(project.doc);
  if (selection.locales.some((l) => !allLocales(project.doc).includes(l))) throw badRequest("unknown_locale");
  await requireRecordingsReady(ctx, project.doc);
  const check = checkExportable(project.doc, selection);
  if (!check.ok) throw badRequest(check.code);
  const type = body.kind === "single" ? "export_single" : "export";
  return withTx(async (tx) => {
    if (type === "export_single") await assertFreeQuota(tx, ctx.workspaceId);
    const versionId = await pinVersion(tx, ctx, project);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type, input: { selection, versionId } });
  });
}
```

Replace `exportDownloadUrl`:

```ts
export const DOWNLOAD_EXT = { export: "zip", export_single: "png", video: "mp4", project_bundle: "chitrapx" } as const;

/** A short-lived download link for a finished export, single PNG, video or project file in this workspace. */
export async function exportDownloadUrl(ctx: Ctx, storage: Pick<ObjectStorage, "signedDownload">, jobId: string): Promise<string> {
  if (!z.uuid().safeParse(jobId).success) throw notFound();
  const [job] = await db.select().from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.workspaceId, ctx.workspaceId), inArray(schema.jobs.type, Object.keys(DOWNLOAD_EXT))));
  if (!job) throw notFound();
  if (job.status !== "done") throw new HttpError(409, "not_ready");
  const ext = DOWNLOAD_EXT[job.type as keyof typeof DOWNLOAD_EXT];
  // Built from ids, never from stored output, so a download can only ever reach this workspace's files.
  return storage.signedDownload(`${ctx.workspaceId}/${job.id}.${ext}`, `chitrapx-${job.type.replace("_", "-")}-${job.id.slice(0, 8)}.${ext}`);
}
```

`apps/web/src/app/api/projects/[projectId]/export/route.ts`: GET filter becomes `(j) => j.type === "export" || j.type === "export_single"`; POST body default becomes `await req.json().catch(() => ({ kind: "zip" }))`.

- [ ] **Step 5: Render page and worker**

Render page: `inArray(schema.jobs.type, ["export", "export_single", "video"])`.

`apps/worker/src/export.ts`: signature `export async function runExport(input: unknown, job: JobContext, kind: "zip" | "single" = "zip")`. After the `finally { await browser.close(); }` block, before the ZIP:

```ts
  if (kind === "single") {
    const only = plan.length === 1 ? files[plan[0]!.file] : undefined;
    if (!only) throw new FatalJobError("single_export_needs_one_board");
    const path = `${job.workspaceId}/${job.id}.png`;
    const { error } = await storage().upload(path, only, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
    return { actual: PRICES.export_single, output: { path, files: 1, bytes: only.byteLength } };
  }
```

`apps/worker/src/handlers.ts` (`handlers` must stay a complete `Record<JobType, JobHandler>`):

```ts
  export_single: (input, job) => runExport(input, job, "single"),
  // Implemented in Tasks 9 and 10; nothing enqueues these before then.
  project_bundle: async () => { throw new FatalJobError("not_available"); },
  project_import: async () => { throw new FatalJobError("not_available"); },
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @chitrapx/web exec vitest run test/jobs.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/web apps/worker
git commit -m "feat(export): free single-board PNG export with a 30 per hour limit"
```

---

### Task 6: Opaque PNGs and the export report

**Files:**
- Create: `apps/worker/src/storeFiles.ts`
- Modify: `apps/worker/src/export.ts`, `apps/worker/test-e2e/export.test.ts:56-60`
- Test: `apps/worker/test/storeFiles.test.ts`

**Interfaces:**
- Consumes: `storeReadiness`, `ReadinessIssue`, `ExportItem`, `getTarget`.
- Produces:
  ```ts
  type FileIssue = { file: string; severity: "error" | "warning"; code: "transparent_pixels" | "file_too_large"; message: string };
  MAX_STORE_BYTES = 8 * 1024 * 1024
  finishPng(png: Buffer, file: string): Promise<{ png: Buffer; issues: FileIssue[] }>
  reportText(doc: ChitrapxDoc, plan: ExportItem[], pre: ReadinessIssue[], post: FileIssue[]): string
  // export job output gains `issues: number`; the ZIP gains report.txt
  ```

- [ ] **Step 1: Write failing tests**

```ts
// apps/worker/test/storeFiles.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { exportPlan, storeReadiness, type ChitrapxDoc } from "@chitrapx/document";
import { finishPng, reportText } from "../src/storeFiles.ts";

const png = (alpha: number) => sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha } } }).png().toBuffer();

describe("finishPng", () => {
  it("removes the alpha channel and warns when pixels were transparent", async () => {
    const out = await finishPng(await png(0), "ios/x/en-US/01-a.png");
    expect(await sharp(out.png).metadata()).toMatchObject({ channels: 3, hasAlpha: false, width: 4, height: 4 });
    expect(out.issues).toEqual([expect.objectContaining({ code: "transparent_pixels", severity: "warning", file: "ios/x/en-US/01-a.png" })]);
  });

  it("keeps an opaque image's pixels and reports nothing", async () => {
    const out = await finishPng(await png(1), "f.png");
    expect(out.issues).toEqual([]);
    const { data } = await sharp(out.png).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([10, 20, 30]);
  });
});

describe("reportText", () => {
  it("lists store issues, file issues and derived sizes", () => {
    const b = { id: "a", name: "a", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, elements: [], backgroundColor: "#fff", zoom: 1 };
    const doc = { schemaVersion: 1, kind: "screenshots", groups: [{ id: "g1", target: "iphone-6.9", boards: [b], spanElements: [] }],
      localization: { baseLocale: "en-US", locales: [] } } as unknown as ChitrapxDoc;
    const plan = exportPlan(doc, { targets: ["iphone-6.9", "iphone-5.5"], locales: ["en-US"] });
    const text = reportText(doc, plan, storeReadiness(plan, doc), [{ file: plan[0]!.file, severity: "warning", code: "transparent_pixels", message: "filled" }]);
    expect(text).toContain("2 PNGs");
    expect(text).toContain("[warning] App Store:");
    expect(text).toContain(`[warning] ${plan[0]!.file}: filled`);
    expect(text).toContain('iPhone 5.5": from iPhone 6.9" (letterboxed)');
  });

  it("says when there is nothing to report", () => {
    expect(reportText({ groups: [] } as unknown as ChitrapxDoc, [], [], [])).toContain("Store readiness\n- No issues");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/worker exec vitest run test/storeFiles.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `apps/worker/src/storeFiles.ts`**

```ts
import sharp from "sharp";
import { getTarget, type ChitrapxDoc, type ExportItem, type ReadinessIssue } from "@chitrapx/document";

export type FileIssue = { file: string; severity: "error" | "warning"; code: "transparent_pixels" | "file_too_large"; message: string };

/** Google Play's per-screenshot limit; App Store Connect allows more. */
export const MAX_STORE_BYTES = 8 * 1024 * 1024;

/** Both stores reject screenshots with an alpha channel: flatten onto white and drop it. */
export async function finishPng(png: Buffer, file: string): Promise<{ png: Buffer; issues: FileIssue[] }> {
  const issues: FileIssue[] = [];
  const { isOpaque } = await sharp(png).stats();
  if (!isOpaque) issues.push({ file, severity: "warning", code: "transparent_pixels", message: "Transparent pixels were filled with white. The stores reject transparency." });
  const out = await sharp(png).flatten({ background: "#ffffff" }).removeAlpha().png().toBuffer();
  if (out.byteLength > MAX_STORE_BYTES) {
    issues.push({ file, severity: "error", code: "file_too_large", message: `${(out.byteLength / 1024 / 1024).toFixed(1)} MB. Google Play takes up to 8 MB per screenshot.` });
  }
  return { png: out, issues };
}

const STORE_NAME = { "app-store": "App Store", play: "Google Play" } as const;

/** report.txt at the root of every export ZIP. */
export function reportText(doc: ChitrapxDoc, plan: ExportItem[], pre: ReadinessIssue[], post: FileIssue[]): string {
  const lines = ["Chitrapx export report", `${plan.length} PNGs`, "", "Store readiness"];
  lines.push(...(pre.length ? pre.map((i) => `- [${i.severity}] ${STORE_NAME[i.store]}: ${i.message}`) : ["- No issues"]));
  lines.push("", "Files");
  lines.push(...(post.length ? post.map((i) => `- [${i.severity}] ${i.file}: ${i.message}`) : ["- No issues"]));
  const derived = [...new Map(plan.filter((i) => i.derived).map((i) => [i.targetId, i])).values()];
  if (derived.length) {
    lines.push("", "Sizes made from another size");
    for (const i of derived) {
      const from = getTarget(doc.groups.find((g) => g.id === i.sourceGroupId)!.target)!;
      lines.push(`- ${getTarget(i.targetId)!.label}: from ${from.label}${i.letterboxed ? " (letterboxed)" : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Use it in `runExport`**

In `apps/worker/src/export.ts`: import `strToU8` (with `zipSync`) from `fflate`, `storeReadiness` from `@chitrapx/document`, `finishPng, reportText, type FileIssue` from `./storeFiles.ts`. Before `const browser = await launch();` add `const post: FileIssue[] = [];`. Replace `files[item.file] = png;` with:

```ts
        const done = await finishPng(png, item.file);
        post.push(...done.issues);
        files[item.file] = done.png;
```

Replace the ZIP tail (after the Task 5 single branch):

```ts
  const pre = storeReadiness(plan, src.doc);
  files["report.txt"] = strToU8(reportText(src.doc, plan, pre, post));
  const zip = zipSync(files, { level: 0 }); // PNGs are already compressed
  const path = `${job.workspaceId}/${job.id}.zip`;
  const { error } = await storage().upload(path, zip, { contentType: "application/zip", upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return { actual: PRICES.export, output: { path, files: plan.length, bytes: zip.byteLength, issues: pre.length + post.length } };
```

- [ ] **Step 5: Keep the existing e2e assertions true with report.txt in the ZIP**

In `apps/worker/test-e2e/export.test.ts`, first test (`renders every board at exact store size...`), replace:
```ts
    expect(Object.keys(files)).toHaveLength(5);
    for (const [name, png] of Object.entries(files)) {
```
with:
```ts
    expect(Object.keys(files).filter((f) => f.endsWith(".png"))).toHaveLength(5);
    expect(files["report.txt"]).toBeDefined();
    for (const [name, png] of Object.entries(files).filter(([f]) => f.endsWith(".png"))) {
```
The golden test's `Object.keys(files).sort()[0]` is still a PNG (`ios/...` sorts before `report.txt`).

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @chitrapx/worker test && pnpm typecheck && pnpm lint`, then with `pnpm dev` running: `pnpm --filter @chitrapx/worker test:e2e`
Expected: PASS, golden images unchanged (flattening an opaque image keeps its pixels).

- [ ] **Step 7: Commit**

```bash
git add apps/worker
git commit -m "feat(export): opaque RGB PNGs and a store-readiness report.txt in every ZIP"
```

---

### Task 7: Export dialog, Download PNG and autosave flush

**Files:**
- Create: `apps/web/src/components/ExportDialog.tsx`, `apps/web/src/components/useJobDownload.ts`
- Modify: `apps/web/src/components/ExportPanel.tsx`, `apps/web/src/app/dashboard/projects/[projectId]/page.tsx:31-33`, `apps/web/src/editor/save.ts`, `apps/web/src/editor/Editor.tsx`, `apps/web/src/editor/ui/Toolbar.tsx`, `apps/web/src/editor/ui/LeftPanel.tsx`, `apps/web/src/components/jobText.ts`
- Test: browser checks (Step 6) plus `pnpm typecheck && pnpm lint && pnpm test`

**Interfaces:**
- Consumes: `exportPlan`, `sourcesFor`, `storeReadiness`, `presetSelection`, `suggestedSelection`, `allLocales`, `MAX_EXPORT_ITEMS`, `TARGETS`, `getTarget`; `GET/POST /api/projects/:id/export` (GET rows include `input`), `GET /api/jobs/:id`, `GET /api/jobs/:id/download`.
- Produces:
  ```ts
  useAutosave(store) returns { status, error, conflict, loadTheirs, keepMine, flush(): Promise<boolean> }
  useJobDownload(): { busy: boolean; error: string; start(path: string, body: unknown, before?: () => Promise<boolean>): Promise<void> }
  <ExportDialog projectId doc onClose beforeExport? onAddSize?(target, fromGroupId) onJump?(groupId, boardIndex) />
  <ExportPanel projectId doc />
  ```

- [ ] **Step 1: `flush` in `apps/web/src/editor/save.ts`**

Inside `useAutosave`, just before `return { status, error, conflict, loadTheirs, keepMine };`:

```ts
  /** Saves now. True once the server has the current document; false when it cannot (offline, rejected, conflict). */
  async function flush(): Promise<boolean> {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    for (let i = 0; inFlight.current && i < 150; i++) await new Promise((r) => setTimeout(r, 100));
    if (inFlight.current) return false;
    await save();
    return !store.getState().dirty;
  }
```

and return `{ status, error, conflict, loadTheirs, keepMine, flush }`.

- [ ] **Step 2: `apps/web/src/components/useJobDownload.ts`**

```ts
"use client";

import { useState } from "react";
import { api, ApiError } from "@/server/api.ts";
import { jobError } from "./jobText.ts";

type Job = { id: string; status: string; error: string | null };

/** Queues a free job, follows it, then downloads its file. `before` runs first (e.g. saving the editor). */
export function useJobDownload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(path: string, body: unknown, before?: () => Promise<boolean>) {
    setError("");
    setBusy(true);
    try {
      if (before && !(await before())) { setError("Save your changes first."); return; }
      const { jobId } = await api<{ jobId: string }>(path, "POST", body);
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await api<Job>(`/api/jobs/${jobId}`);
        if (job.status === "done") { window.location.assign(`/api/jobs/${jobId}/download`); return; }
        if (job.status === "failed") { setError(jobError(job.error)); return; }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, start };
}
```

- [ ] **Step 3: `apps/web/src/components/ExportDialog.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  allLocales, exportPlan, getTarget, MAX_EXPORT_ITEMS, presetSelection, sourcesFor, storeReadiness, suggestedSelection, TARGETS,
  type ChitrapxDoc, type ExportPreset, type ExportSelection, type Target, type TargetId,
} from "@chitrapx/document";
import { api, ApiError } from "@/server/api.ts";
import { jobError } from "./jobText.ts";

type ExportJob = { id: string; type: string; status: string; error: string | null; createdAt: string;
  input: { selection?: ExportSelection } | null; output: { files?: number; bytes?: number; issues?: number } | null };

const PLATFORM_NAME: Record<string, string> = {
  ios: "iPhone", ipad: "iPad", mac: "Mac", watch: "Apple Watch", tv: "Apple TV", vision: "Vision Pro",
  android: "Android", play: "Google Play", preview: "App Preview", social: "Social",
};
const PRESETS: Array<[ExportPreset, string]> = [["app-store", "App Store required"], ["play", "Play required"], ["everything", "Everything"]];
const BY_PLATFORM = TARGETS.reduce<Record<string, Target[]>>((acc, t) => ({ ...acc, [t.platform]: [...(acc[t.platform] ?? []), t] }), {});

export function ExportDialog({ projectId, doc, onClose, beforeExport, onAddSize, onJump }: {
  projectId: string; doc: ChitrapxDoc; onClose: () => void;
  /** Editor: save before the server renders the saved document. */
  beforeExport?: () => Promise<boolean>;
  /** Editor: turn a derived size into an editable group. */
  onAddSize?: (target: TargetId, fromGroupId: string) => void;
  /** Editor: open the board an issue points at. */
  onJump?: (groupId: string, boardIndex: number) => void;
}) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [selection, setSelection] = useState<ExportSelection | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<"app-store" | "play" | null>(null);
  const load = useCallback(async () => (await api<ExportJob[]>(`/api/projects/${projectId}/export`)).filter((j) => j.type === "export"), [projectId]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    load().then((js) => {
      setJobs(js);
      const last = js.find((j) => j.input?.selection)?.input?.selection;
      const known = allLocales(doc);
      // A language removed since the last export is dropped; nothing left falls back to the suggestion.
      const reuse = last && { ...last, board: undefined, locales: last.locales.filter((l) => known.includes(l)) };
      setSelection(reuse?.locales.length ? reuse : suggestedSelection(doc));
    }).catch(() => setSelection(suggestedSelection(doc)));
  }, [load, doc]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => load().then(setJobs).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [active, load]);

  const plan = useMemo(() => (selection ? exportPlan(doc, selection) : []), [doc, selection]);
  const issues = useMemo(() => storeReadiness(plan, doc), [plan, doc]);
  const hasSocial = doc.groups.some((g) => getTarget(g.target)?.platform === "social");
  if (!selection) return null;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const tooMany = plan.length > MAX_EXPORT_ITEMS;
  const stores = (["app-store", "play"] as const).filter((s) => issues.some((i) => i.store === s)
    || plan.some((i) => (s === "play") === ["android", "play"].includes(getTarget(i.targetId)!.platform)));

  async function start() {
    setError("");
    try {
      if (beforeExport && !(await beforeExport())) { setError("Save your changes first."); return; }
      await api(`/api/projects/${projectId}/export`, "POST", { kind: "zip", selection });
      setJobs(await load());
    } catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong."); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Export" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="card w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map(([p, label]) => (
            <button key={p} type="button" className="btn-ghost text-sm" onClick={() => setSelection(presetSelection(doc, p))}>{label}</button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(BY_PLATFORM).filter(([p]) => p !== "social" || hasSocial).map(([platform, targets]) => (
            <fieldset key={platform} className="space-y-1">
              <legend className="label">{PLATFORM_NAME[platform]}</legend>
              {targets.map((t) => {
                const src = sourcesFor(doc, t.id as TargetId);
                const from = src.groups[0];
                const tag = !from ? "No boards" : !src.derived ? "Designed"
                  : src.letterboxed ? "Letterboxed" : `Auto from ${getTarget(from.target)!.label}`;
                return (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={!from} checked={selection.targets.includes(t.id as TargetId)}
                      onChange={() => setSelection({ ...selection, targets: toggle(selection.targets, t.id as TargetId) })} />
                    <span className="flex-1">{t.label} <span className="text-neutral-400">{t.width}×{t.height}</span></span>
                    <span className={`text-xs ${src.letterboxed ? "text-amber-600" : "text-neutral-500"}`}>{tag}</span>
                    {src.letterboxed && onAddSize && from && (
                      <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => onAddSize(t.id as TargetId, from.id)}>Add as editable size</button>
                    )}
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>

        <fieldset className="flex flex-wrap gap-3">
          <legend className="label">Languages</legend>
          {allLocales(doc).map((l) => (
            <label key={l} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={selection.locales.includes(l)} onChange={() => setSelection({ ...selection, locales: toggle(selection.locales, l) })} />{l}
            </label>
          ))}
        </fieldset>

        <section className="space-y-1">
          {stores.map((s) => {
            const mine = issues.filter((i) => i.store === s);
            const errors = mine.filter((i) => i.severity === "error").length;
            return (
              <div key={s}>
                <button type="button" className="text-sm" onClick={() => setOpen(open === s ? null : s)} aria-expanded={open === s}>
                  {s === "app-store" ? "App Store" : "Google Play"}: {mine.length === 0 ? "✓ ready" : `${errors} to fix, ${mine.length - errors} to check`}
                </button>
                {open === s && (
                  <ul className="mt-1 space-y-1 text-xs">
                    {mine.map((i, k) => (
                      <li key={k}>
                        <button type="button" disabled={!onJump || i.groupId === undefined} className="text-left disabled:cursor-default"
                          onClick={() => i.groupId !== undefined && onJump?.(i.groupId, i.boardIndex ?? 0)}>
                          <span className={i.severity === "error" ? "text-red-600" : "text-amber-600"}>{i.severity === "error" ? "Fix" : "Check"}</span> {i.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        <div className="flex items-center justify-between gap-3">
          <p className={`text-sm ${tooMany ? "text-red-600" : "text-neutral-500"}`}>
            {plan.length} PNGs{tooMany ? `. One export can hold up to ${MAX_EXPORT_ITEMS}.` : ""}
          </p>
          <button className="btn" onClick={start} disabled={active || plan.length === 0 || tooMany}>{active ? "Exporting" : "Export ZIP (1 credit)"}</button>
        </div>
        {error && <p role="alert" className="error">{error}</p>}

        {jobs.length > 0 && (
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-neutral-500">{new Date(j.createdAt).toLocaleString()}</span>
                {j.status === "done" ? (
                  <a className="font-medium text-indigo-600 hover:underline" href={`/api/jobs/${j.id}/download`}>
                    Download {j.output?.files} PNGs ({((j.output?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB){j.output?.issues ? ` · ${j.output.issues} warnings` : ""}
                  </a>
                ) : j.status === "failed" ? (
                  <span className="text-red-600" title={j.error ?? ""}>{jobError(j.error)}</span>
                ) : (
                  <span>{j.status === "queued" ? "Waiting" : "Rendering"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Dashboard and editor wiring**

`apps/web/src/components/ExportPanel.tsx` becomes:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import { ExportDialog } from "./ExportDialog.tsx";

export function ExportPanel({ projectId, doc }: { projectId: string; doc: ChitrapxDoc }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">Export</h2>
        <p className="text-sm text-neutral-500">PNGs at exact store sizes, in one ZIP, with a store-readiness report.</p>
      </div>
      <button className="btn" onClick={() => setOpen(true)}>Export</button>
      {open && <ExportDialog projectId={projectId} doc={doc} onClose={() => { setOpen(false); router.refresh(); }} />}
    </section>
  );
}
```

Project page: `<ExportPanel projectId={project.id} doc={project.doc} />` (drop `boardCount`/`localeCount`).

`apps/web/src/editor/Editor.tsx`: `const { status, error, conflict, loadTheirs, keepMine, flush } = useAutosave(store);`; render `<Toolbar ... flush={flush} />` and `<LeftPanel flush={flush} />`.

`apps/web/src/editor/ui/Toolbar.tsx`: add `flush` to props (`flush: () => Promise<boolean>`), `import { useState } from "react";`, `import { ExportDialog } from "@/components/ExportDialog.tsx";`, `const [exporting, setExporting] = useState(false); const doc = useEditor((s) => s.doc);`. Replace `<Link href={`/dashboard/projects/${projectId}`} className="btn py-1.5">Export</Link>` with:

```tsx
      <button type="button" className="btn py-1.5" onClick={() => setExporting(true)}>Export</button>
      {exporting && (
        <ExportDialog projectId={projectId} doc={doc} onClose={() => setExporting(false)} beforeExport={flush}
          onAddSize={(target, fromGroupId) => store.getState().apply({ type: "addGroupFromTarget", fromGroupId, target, newGroupId: crypto.randomUUID() })}
          onJump={(groupId, boardIndex) => {
            const s = store.getState();
            s.setActiveGroup(groupId);
            const b = s.doc.groups.find((g) => g.id === groupId)?.boards[boardIndex];
            if (b) store.getState().setActiveBoard(b.id);
            setExporting(false);
          }} />
      )}
```

`apps/web/src/editor/ui/LeftPanel.tsx`: signature `export function LeftPanel({ flush }: { flush: () => Promise<boolean> })`; add `import { useJobDownload } from "@/components/useJobDownload.ts";`, and in the body `const projectId = useEditor((s) => s.projectId); const locale = useEditor((s) => s.locale); const png = useJobDownload();`. In each board row's `<span className="flex gap-0.5 ...">`, first child:

```tsx
                <button type="button" aria-label="Download PNG" title="Download this board as a PNG (free)" className="px-1"
                  disabled={png.busy} onClick={() => png.start(`/api/projects/${projectId}/export`, { kind: "single", groupId, boardIndex: i, locale }, flush)}>
                  {png.busy ? "…" : "⤓"}
                </button>
```

After the `</ol>`: `{png.error && <p role="alert" className="error text-xs">{png.error}{png.error.startsWith("Free downloads") ? " Use Export ZIP for full sets." : ""}</p>}`. Confirm the store field name with `grep -n "projectId" apps/web/src/editor/store.ts`.

`apps/web/src/components/jobText.ts` — add to `MESSAGES`:

```ts
  rate_limited: "Free downloads are limited to 30 per hour.",
  single_export_needs_one_board: "That board no longer exists. Reload and try again.",
  project_missing: "This project was deleted.",
```

and set `JOB_LABEL` to `{ ai_design: "AI design", ai_translate: "Translation", ai_copy: "Copy ideas", export: "Export", export_single: "PNG", project_bundle: "Project file", project_import: "Import" }`.

- [ ] **Step 5: Typecheck, lint, tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 6: Check in the browser**

With `pnpm dev` running, open a template project in the editor:
1. Toolbar **Export** opens the dialog on *App Store required* (or the last export's sizes); ticking iPhone 5.5" shows "Letterboxed" and an App Store "to check" count; the PNG count updates.
2. **Add as editable size** on a letterboxed size adds that size in the left panel; reopening the dialog tags it "Designed".
3. **Export ZIP**: a history row appears and finishes; the download contains `report.txt`.
4. Edit a headline and click **⤓** on that board within a second: the downloaded PNG shows the new text.
5. Clicking a readiness issue closes the dialog with that board active.
6. On the project dashboard, **Export** opens the same dialog without the "Add as editable size" buttons.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): export dialog with sizes, languages and store readiness, plus free Download PNG"
```

---

### Task 8: Shared asset checks

**Files:**
- Create: `packages/db/src/assetCheck.ts`, `packages/db/test/assetCheck.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/package.json`, `apps/web/src/server/uploads.ts:12-24,30,83-94`
- Test: the new test plus `apps/web/test/uploads.test.ts` (must stay green)

**Interfaces:**
- Produces:
  ```ts
  type AssetKind = "screenshot" | "image" | "recording";
  UPLOAD_LIMITS: { screenshot; image; recording; font } (bytes)
  ACCEPTED: Record<AssetKind, readonly string[]>
  HEAD_BYTES: Record<AssetKind, number>
  sniffAsset(kind, head: Uint8Array): Promise<{ ok: true; mime: string; width?: number; height?: number } | { ok: false; code: "unsupported_type" | "unreadable_image" }>
  // apps/web/src/server/uploads.ts
  export const stagingPath(ctx, uploadId): string
  ```

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/assetCheck.test.ts
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sniffAsset } from "../src/assetCheck.ts";

function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk("IEND", Buffer.alloc(0))]);
}

describe("sniffAsset", () => {
  it("accepts a PNG screenshot and reads its size", async () => {
    expect(await sniffAsset("screenshot", png(3, 5))).toEqual({ ok: true, mime: "image/png", width: 3, height: 5 });
  });
  it("rejects bytes of a type the kind does not accept, including SVG", async () => {
    expect(await sniffAsset("image", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ ok: false, code: "unsupported_type" });
    expect(await sniffAsset("recording", png(3, 5))).toEqual({ ok: false, code: "unsupported_type" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/db add file-type@^22.1.1 image-size@^2.0.4 && pnpm --filter @chitrapx/db exec vitest run test/assetCheck.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `packages/db/src/assetCheck.ts`** (moved from `uploads.ts`)

```ts
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";

export type AssetKind = "screenshot" | "image" | "recording";

const MB = 1024 * 1024;
export const UPLOAD_LIMITS = { screenshot: 25 * MB, image: 25 * MB, recording: 500 * MB, font: 10 * MB } as const;
// ponytail: SVG stays out until it is sanitized; fonts arrive with their sub-project.
export const ACCEPTED: Record<AssetKind, readonly string[]> = {
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  image: ["image/png", "image/jpeg", "image/webp"],
  recording: ["video/mp4", "video/quicktime", "video/x-m4v"],
};
/** Bytes kept for type sniffing and image dimensions (JPEG headers can sit after a large EXIF block). */
export const HEAD_BYTES: Record<AssetKind, number> = { screenshot: 512 * 1024, image: 512 * 1024, recording: 64 * 1024 };

/** The real type of uploaded bytes (never the client's claim) and, for images, their size. */
export async function sniffAsset(kind: AssetKind, head: Uint8Array):
  Promise<{ ok: true; mime: string; width?: number; height?: number } | { ok: false; code: "unsupported_type" | "unreadable_image" }> {
  const type = await fileTypeFromBuffer(head);
  if (!type || !ACCEPTED[kind].includes(type.mime)) return { ok: false, code: "unsupported_type" };
  if (kind === "recording") return { ok: true, mime: type.mime };
  try {
    const { width, height } = imageSize(head);
    return { ok: true, mime: type.mime, width, height };
  } catch {
    return { ok: false, code: "unreadable_image" };
  }
}
```

Add `export * from "./assetCheck.ts";` to `packages/db/src/index.ts`.

- [ ] **Step 4: Use it in `apps/web/src/server/uploads.ts`**

Delete the local `MB`, `UPLOAD_LIMITS`, `ACCEPTED`, `HEAD_BYTES` and the `fileTypeFromBuffer` / `imageSize` imports; add `import { ACCEPTED, HEAD_BYTES, sniffAsset, UPLOAD_LIMITS } from "@chitrapx/db";` and `export { UPLOAD_LIMITS };` (other files import it from here: check with `grep -rn "UPLOAD_LIMITS" apps/web`). `tooLarge` becomes `` `Files of this type can be up to ${UPLOAD_LIMITS[kind] / (1024 * 1024)} MB` ``. Replace the block from `const type = await fileTypeFromBuffer(headBytes);` through the `imageSize` try/catch with:

```ts
  const sniffed = await sniffAsset(input.kind, headBytes);
  if (!sniffed.ok) return reject(badRequest(sniffed.code));
```

and in the insert use `mime: sniffed.mime, width: sniffed.width ?? null, height: sniffed.height ?? null`. Change `const stagingPath =` to `export const stagingPath =`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @chitrapx/db exec vitest run test/assetCheck.test.ts && pnpm --filter @chitrapx/web exec vitest run test/uploads.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db apps/web pnpm-lock.yaml
git commit -m "refactor(db): share upload limits and byte sniffing with the worker"
```

---

### Task 9: Download project file (`.chitrapx`)

**Files:**
- Create: `packages/document/src/bundle.ts`, `packages/document/test/bundle.test.ts`, `apps/worker/src/bundle.ts`, `apps/worker/test/bundle.test.ts`, `apps/web/src/app/api/projects/[projectId]/bundle/route.ts`, `apps/web/src/components/BundleButton.tsx`
- Modify: `packages/document/src/index.ts`, `apps/web/src/server/projects.ts:124`, `apps/worker/src/handlers.ts`, `apps/web/src/server/jobs.ts`, `apps/web/src/app/dashboard/projects/[projectId]/page.tsx`, `apps/web/src/components/jobText.ts`, `apps/web/test/jobs.test.ts`

**Interfaces:**
- Consumes: `assertFreeQuota`, `useJobDownload`, `DOWNLOAD_EXT.project_bundle`, `CURRENT_SCHEMA_VERSION`.
- Produces:
  ```ts
  // @chitrapx/document
  MAX_DOC_BYTES = 5 * 1024 * 1024
  BUNDLE_FORMAT = "chitrapx-project"; BUNDLE_VERSION = 1; MAX_BUNDLE_BYTES = 500 * 1024 * 1024; MAX_BUNDLE_ENTRIES = 500
  bundleManifestSchema; type BundleManifest = { format; version; docSchema; appName; exportedAt;
    assets: Array<{ sha256: string; kind: "screenshot" | "image" | "recording"; mime: string }> }
  docAssetRefs(doc): string[]   // asset ids referenced anywhere
  docBundleRefs(doc): string[]  // sha256s referenced as bundle:
  toBundleDoc(doc, shaOf: (assetId) => string | undefined): ChitrapxDoc   // throws Error("asset_missing:<id>")
  fromBundleDoc(doc, idOf: (sha) => string | undefined): ChitrapxDoc      // throws Error("bundle_invalid")
  extFor(mime): string
  // apps/worker/src/bundle.ts
  type BundleDeps = { download(path): Promise<Buffer>; upload(path, bytes: Uint8Array, contentType, bucket: "uploads" | "exports"): Promise<void>; remove(path): Promise<void> }
  packBundle(manifest: BundleManifest, doc: ChitrapxDoc, files: Record<string, Uint8Array>): Uint8Array
  runBundle(input, job, deps): Promise<{ actual: number; output: { path: string; bytes: number; assets: number } }>
  // apps/worker/src/handlers.ts
  export const bundleDeps: BundleDeps
  // apps/web
  enqueueBundle(ctx, boss, projectId): Promise<{ jobId: string }>   // POST /api/projects/:id/bundle
  ```

- [ ] **Step 1: Write failing document tests**

```ts
// packages/document/test/bundle.test.ts
import { describe, expect, it } from "vitest";
import { docAssetRefs, docBundleRefs, fromBundleDoc, toBundleDoc } from "../src/index.ts";
import { board, device, doc, group } from "./fixtures.ts";

const A = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

describe("bundle doc rewrite", () => {
  const d = doc([group([board("b1", [device("d1", 0, `asset:${A}`), { ...device("d2", 0), posterSrc: `asset:${A}#poster` } as never])])]);

  it("finds every asset reference, including #poster", () => {
    expect(docAssetRefs(d)).toEqual([A]);
  });

  it("round-trips asset: -> bundle: -> asset:", () => {
    const b = toBundleDoc(d, (id) => (id === A ? SHA : undefined));
    expect(JSON.stringify(b)).not.toContain("asset:");
    expect(docBundleRefs(b)).toEqual([SHA]);
    expect(fromBundleDoc(b, (s) => (s === SHA ? A : undefined))).toEqual(d);
  });

  it("refuses a reference with no file", () => {
    expect(() => toBundleDoc(d, () => undefined)).toThrow(`asset_missing:${A}`);
    expect(() => fromBundleDoc(toBundleDoc(d, () => SHA), () => undefined)).toThrow("bundle_invalid");
  });
});
```

Run: `pnpm --filter @chitrapx/document exec vitest run test/bundle.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `packages/document/src/bundle.ts`**

```ts
import { z } from "zod";
import type { ChitrapxDoc } from "./doc.ts";

/** Largest document we store or import. */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export const BUNDLE_FORMAT = "chitrapx-project";
export const BUNDLE_VERSION = 1;
/** The uploads bucket's limit; a larger file could not be imported. */
export const MAX_BUNDLE_BYTES = 500 * 1024 * 1024;
export const MAX_BUNDLE_ENTRIES = 500;

export const bundleManifestSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int(),
  docSchema: z.number().int(),
  appName: z.string().max(200),
  exportedAt: z.string().max(40),
  assets: z.array(z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["screenshot", "image", "recording"]),
    mime: z.string().max(100),
  })).max(MAX_BUNDLE_ENTRIES),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

const ASSET = /^asset:([0-9a-f-]{36})(#[a-z]+)?$/;
const BUNDLE = /^bundle:([a-f0-9]{64})(#[a-z]+)?$/;

/** Every string in the document through `fn`; documents are plain JSON. */
function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)])) as T;
  return value;
}
function collect(doc: ChitrapxDoc, re: RegExp): string[] {
  const found = new Set<string>();
  mapStrings(doc, (s) => { const m = re.exec(s); if (m) found.add(m[1]!); return s; });
  return [...found];
}

export const docAssetRefs = (doc: ChitrapxDoc) => collect(doc, ASSET);
export const docBundleRefs = (doc: ChitrapxDoc) => collect(doc, BUNDLE);

export function toBundleDoc(doc: ChitrapxDoc, shaOf: (assetId: string) => string | undefined): ChitrapxDoc {
  return mapStrings(doc, (s) => {
    const m = ASSET.exec(s);
    if (!m) return s;
    const sha = shaOf(m[1]!);
    if (!sha) throw new Error(`asset_missing:${m[1]}`);
    return `bundle:${sha}${m[2] ?? ""}`;
  });
}

export function fromBundleDoc(doc: ChitrapxDoc, idOf: (sha: string) => string | undefined): ChitrapxDoc {
  return mapStrings(doc, (s) => {
    const m = BUNDLE.exec(s);
    if (!m) return s;
    const id = idOf(m[1]!);
    if (!id) throw new Error("bundle_invalid");
    return `asset:${id}${m[2] ?? ""}`;
  });
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/x-m4v": "m4v" };
export const extFor = (mime: string) => EXT[mime] ?? "bin";
```

Add `export * from "./bundle.ts";` to `packages/document/src/index.ts`. In `apps/web/src/server/projects.ts` replace `export const MAX_DOC_BYTES = 5 * 1024 * 1024;` with `export { MAX_DOC_BYTES } from "@chitrapx/document";` and add `MAX_DOC_BYTES` to that file's `@chitrapx/document` import (it is used by `saveDoc` in the same file).

Run: `pnpm --filter @chitrapx/document test` — Expected: PASS.

- [ ] **Step 3: Write failing worker tests**

```ts
// apps/worker/test/bundle.test.ts
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { runBundle, type BundleDeps } from "../src/bundle.ts";
import { runJob } from "../src/runJob.ts";

let PNG: Buffer;
beforeAll(async () => { PNG = await sharp({ create: { width: 2, height: 3, channels: 3, background: "#123456" } }).png().toBuffer(); });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Uploads-bucket objects keyed by path; uploads are stored as "<bucket>:<path>". */
function memoryDeps(): BundleDeps & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async download(path) { const f = files.get(path); if (!f) throw new Error(`missing ${path}`); return f; },
    async upload(path, bytes, _type, bucket) { files.set(`${bucket}:${path}`, Buffer.from(bytes)); },
    async remove(path) { files.delete(path); },
  };
}
const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

async function projectWithAsset() {
  const ws = await makeWorkspace((await createUser()).id);
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Bundle app" }).returning();
  const hash = sha(PNG);
  const [asset] = await db.insert(schema.assets).values({ workspaceId: ws, appId: app!.id, kind: "screenshot", storagePath: `${ws}/${hash}`, mime: "image/png", bytes: PNG.length, sha256: hash, width: 2, height: 3 }).returning();
  const b = { id: "b1", name: "b1", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: [{ id: "d", type: "device", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, screenshotSrc: `asset:${asset!.id}` }] };
  const doc = { schemaVersion: 1, kind: "screenshots", groups: [{ id: "g1", target: "iphone-6.9", boards: [b], spanElements: [] }], localization: { baseLocale: "en-US", locales: [] } };
  const [project] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: "P", kind: "screenshots", doc }).returning();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: project!.id, type: "project_bundle", creditsReserved: 0 }).returning();
  const deps = memoryDeps();
  deps.files.set(`${ws}/${hash}`, PNG);
  return { ws, hash, assetId: asset!.id, jobId: job!.id, deps };
}

describe("project_bundle", () => {
  it("packs the manifest, the rewritten doc and the asset originals", async () => {
    const p = await projectWithAsset();
    await runJob(p.jobId, (input, job) => runBundle(input, job, p.deps));
    expect((await jobRow(p.jobId)).status).toBe("done");
    const zip = unzipSync(new Uint8Array(p.deps.files.get(`exports:${p.ws}/${p.jobId}.chitrapx`)!));
    expect(JSON.parse(strFromU8(zip["manifest.json"]!))).toMatchObject({
      format: "chitrapx-project", version: 1, docSchema: 1, appName: "Bundle app", assets: [{ sha256: p.hash, kind: "screenshot", mime: "image/png" }],
    });
    expect(strFromU8(zip["doc.json"]!)).toContain(`bundle:${p.hash}`);
    expect(Buffer.from(zip[`assets/${p.hash}.png`]!)).toEqual(PNG);
  });

  it("fails with asset_missing when the document references a deleted asset", async () => {
    const p = await projectWithAsset();
    await db.delete(schema.assets).where(eq(schema.assets.id, p.assetId));
    await runJob(p.jobId, (input, job) => runBundle(input, job, p.deps));
    const job = await jobRow(p.jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/^asset_missing/);
  });
});
```

Run: `pnpm --filter @chitrapx/worker exec vitest run test/bundle.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 4: Implement `apps/worker/src/bundle.ts` (bundle half)**

```ts
import { and, eq, inArray } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { db, PRICES, schema } from "@chitrapx/db";
import {
  BUNDLE_FORMAT, BUNDLE_VERSION, CURRENT_SCHEMA_VERSION, docAssetRefs, extFor, MAX_BUNDLE_BYTES, migrate, toBundleDoc,
  type BundleManifest, type ChitrapxDoc,
} from "@chitrapx/document";
import { FatalJobError, type JobContext } from "./runJob.ts";

export type BundleDeps = {
  /** An object from the uploads bucket. */
  download(path: string): Promise<Buffer>;
  upload(path: string, bytes: Uint8Array, contentType: string, bucket: "uploads" | "exports"): Promise<void>;
  /** Removes an object from the uploads bucket. */
  remove(path: string): Promise<void>;
};

type BundleAssetKind = BundleManifest["assets"][number]["kind"];
const BUNDLE_KINDS: readonly string[] = ["screenshot", "image", "recording"];

export function packBundle(manifest: BundleManifest, doc: ChitrapxDoc, files: Record<string, Uint8Array>): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "doc.json": strToU8(JSON.stringify(doc)),
    ...files,
  }, { level: 0 }); // images and videos are already compressed
}

// ponytail: the whole file is held in memory (up to MAX_BUNDLE_BYTES); switch to fflate's streaming Zip if worker memory gets tight.
export async function runBundle(_input: unknown, job: JobContext, deps: BundleDeps) {
  if (!job.projectId) throw new FatalJobError("project_missing");
  const [row] = await db.select({ doc: schema.projects.doc, appName: schema.apps.name }).from(schema.projects)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.projects.appId))
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!row) throw new FatalJobError("project_missing");
  const doc = migrate(row.doc);
  const ids = docAssetRefs(doc);
  const assets = ids.length ? await db.select().from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, job.workspaceId), inArray(schema.assets.id, ids))) : [];
  const byId = new Map(assets.map((a) => [a.id, a]));

  let bundled: ChitrapxDoc;
  try { bundled = toBundleDoc(doc, (id) => byId.get(id)?.sha256); }
  catch (err) { throw new FatalJobError((err as Error).message); }

  const unique = [...new Map(assets.map((a) => [a.sha256, a])).values()];
  if (unique.some((a) => !BUNDLE_KINDS.includes(a.kind))) throw new FatalJobError("bundle_invalid");
  if (unique.reduce((n, a) => n + a.bytes, 0) > MAX_BUNDLE_BYTES) throw new FatalJobError("bundle_too_large");

  const files: Record<string, Uint8Array> = {};
  for (const a of unique) files[`assets/${a.sha256}.${extFor(a.mime)}`] = await deps.download(`${job.workspaceId}/${a.sha256}`);
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, docSchema: CURRENT_SCHEMA_VERSION, appName: row.appName,
    exportedAt: new Date().toISOString(),
    assets: unique.map((a) => ({ sha256: a.sha256, kind: a.kind as BundleAssetKind, mime: a.mime })),
  };
  const zip = packBundle(manifest, bundled, files);
  const path = `${job.workspaceId}/${job.id}.chitrapx`;
  await deps.upload(path, zip, "application/zip", "exports");
  return { actual: PRICES.project_bundle, output: { path, bytes: zip.byteLength, assets: unique.length } };
}
```

In `apps/worker/src/handlers.ts` add (imports: `runBundle, type BundleDeps` from `./bundle.ts`):

```ts
const storageApi = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage;

export const bundleDeps: BundleDeps = {
  async download(path) {
    const { data, error } = await storageApi().from("uploads").download(path);
    if (error) throw new FatalJobError(`asset_missing:${path.split("/").pop()!.slice(0, 12)}`);
    return Buffer.from(await data.arrayBuffer());
  },
  async upload(path, bytes, contentType, bucket) {
    const { error } = await storageApi().from(bucket).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
  },
  async remove(path) { await storageApi().from("uploads").remove([path]); },
};
```

and replace the `project_bundle` placeholder with `project_bundle: (input, job) => runBundle(input, job, bundleDeps),`.

Run: `pnpm --filter @chitrapx/worker exec vitest run test/bundle.test.ts` — Expected: PASS.

- [ ] **Step 5: Web enqueue, route and button**

`apps/web/src/server/jobs.ts`:

```ts
/** Free: queues a .chitrapx file of the project (document plus every referenced upload). */
export async function enqueueBundle(ctx: Ctx, boss: PgBoss, projectId: string): Promise<{ jobId: string }> {
  await getProject(ctx, projectId);
  return withTx(async (tx) => {
    await assertFreeQuota(tx, ctx.workspaceId);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type: "project_bundle", input: {} });
  });
}
```

`apps/web/src/app/api/projects/[projectId]/bundle/route.ts`:

```ts
import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { enqueueBundle } from "@/server/jobs.ts";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ projectId: string }> }) =>
  Response.json(await enqueueBundle(await requireContext(), await getBoss(), (await params).projectId), { status: 201 }));
```

`apps/web/src/components/BundleButton.tsx`:

```tsx
"use client";

import { useJobDownload } from "./useJobDownload.ts";

export function BundleButton({ projectId }: { projectId: string }) {
  const job = useJobDownload();
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="btn-ghost" disabled={job.busy} onClick={() => job.start(`/api/projects/${projectId}/bundle`, {})}>
        {job.busy ? "Packing" : "Download project file"}
      </button>
      {job.error && <span role="alert" className="error text-xs">{job.error}</span>}
    </span>
  );
}
```

Project page: import it and render `<BundleButton projectId={project.id} />` before `<SocialButton ... />`.

`jobText.ts` `MESSAGES`: `bundle_too_large: "This project's screenshots and recordings are over 500 MB, too large for one project file.",`.

Web test (append to `apps/web/test/jobs.test.ts`; `beforeAll` adds `await boss.createQueue("project_bundle");`; import `enqueueBundle`):

```ts
it("project files share the free hourly allowance with single PNGs", async () => {
  await seedTemplates();
  const ctx = await ctxWith(0);
  const app = await createApp(ctx, { name: "A" });
  const p = await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" });
  await expect(enqueueBundle(ctx, boss, p.id)).resolves.toHaveProperty("jobId");
  await db.insert(schema.jobs).values(Array.from({ length: 29 }, () => ({ workspaceId: ctx.workspaceId, type: "export_single", creditsReserved: 0 })));
  await expect(enqueueBundle(ctx, boss, p.id)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/document apps/worker apps/web
git commit -m "feat: download a project as a .chitrapx file with its screenshots and recordings"
```

---

### Task 10: Import a project file

**Files:**
- Create: `apps/worker/src/boss.ts`, `apps/web/src/server/imports.ts`, `apps/web/src/app/api/apps/[appId]/imports/sign/route.ts`, `apps/web/src/app/api/apps/[appId]/imports/route.ts`, `apps/web/src/components/ImportProjectButton.tsx`
- Modify: `apps/worker/src/index.ts:1-8`, `apps/worker/src/bundle.ts`, `apps/worker/src/handlers.ts`, `apps/web/src/app/dashboard/apps/[appId]/page.tsx`, `apps/web/src/components/jobText.ts`
- Test: `apps/worker/test/bundle.test.ts`

**Interfaces:**
- Consumes: `packBundle`, `bundleManifestSchema`, `fromBundleDoc`, `docBundleRefs`, `extFor`, `sniffAsset`, `HEAD_BYTES`, `UPLOAD_LIMITS`, `MAX_BUNDLE_*`, `MAX_DOC_BYTES`, `BUNDLE_FORMAT`, `BUNDLE_VERSION`, `stagingPath`, `reserveAndEnqueue`, `lockWorkspace`, `PLANS`, `bundleDeps`.
- Produces:
  ```ts
  // apps/worker/src/boss.ts
  export const boss: PgBoss
  // apps/worker/src/bundle.ts
  type QueueRecording = (tx: Tx, workspaceId: string, assetId: string) => Promise<unknown>
  runImport(input: { appId; uploadId; name }, job, deps: BundleDeps, queue?: QueueRecording):
    Promise<{ actual: number; output: { projectId: string } }>
  // apps/web/src/server/imports.ts
  signImport(ctx, storage, appId, raw: { size: number }): Promise<{ uploadId: string; path: string; token: string }>
  enqueueImport(ctx, boss, appId, raw: { uploadId: string; name: string }): Promise<{ jobId: string }>
  ```

- [ ] **Step 1: Write failing worker tests**

In `apps/worker/test/bundle.test.ts`: change the bundle import to `import { packBundle, runBundle, runImport, type BundleDeps } from "../src/bundle.ts";` and add `strToU8, zipSync` to the `fflate` import. Append:

```ts
const docWith = (src: string) => ({ schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
  groups: [{ id: "g1", target: "iphone-6.9", spanElements: [], boards: [{ id: "b1", name: "b1", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: [{ id: "d", type: "device", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, screenshotSrc: src }] }] }] });
const manifest = (over: object = {}) => ({ format: "chitrapx-project", version: 1, docSchema: 1, appName: "X", exportedAt: "2026-10-03T12:00:00Z",
  assets: [{ sha256: sha(PNG), kind: "screenshot", mime: "image/png" }], ...over });
const good = () => packBundle(manifest() as never, docWith(`bundle:${sha(PNG)}`) as never, { [`assets/${sha(PNG)}.png`]: PNG });

/** An import job for a fresh workspace (pro plan unless told otherwise) with `bundle` in staging. */
async function importInto(bundle: Uint8Array, plan: "free" | "pro" = "pro", ws?: string, appId?: string) {
  ws ??= await makeWorkspace((await createUser()).id);
  await db.update(schema.workspaces).set({ plan }).where(eq(schema.workspaces.id, ws));
  appId ??= (await db.insert(schema.apps).values({ workspaceId: ws, name: "Target" }).returning())[0]!.id;
  const uploadId = crypto.randomUUID();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, type: "project_import", creditsReserved: 0, input: { appId, uploadId, name: "Imported" } }).returning();
  const deps = memoryDeps();
  deps.files.set(`${ws}/staging/${uploadId}`, Buffer.from(bundle));
  await runJob(job!.id, (input, j) => runImport(input, j, deps, async () => {}));
  return { ws, appId, uploadId, deps, job: await jobRow(job!.id) };
}

describe("project_import", () => {
  it("creates a project whose sources point at this workspace's assets, and removes the upload", async () => {
    const r = await importInto(good());
    expect(r.job.status).toBe("done");
    const projectId = (r.job.output as { projectId: string }).projectId;
    const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    expect(p).toMatchObject({ workspaceId: r.ws, appId: r.appId, name: "Imported" });
    const src = (p!.doc as ReturnType<typeof docWith>).groups[0]!.boards[0]!.elements[0]!.screenshotSrc;
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, src.replace("asset:", "")));
    expect(asset).toMatchObject({ workspaceId: r.ws, appId: r.appId, sha256: sha(PNG), mime: "image/png", width: 2, height: 3 });
    expect(r.deps.files.has(`${r.ws}/staging/${r.uploadId}`)).toBe(false);
    expect(r.deps.files.get(`uploads:${r.ws}/${sha(PNG)}`)).toEqual(PNG);
  });

  async function fails(bundle: Uint8Array, code: string) {
    const r = await importInto(bundle);
    expect(r.job.status).toBe("failed");
    expect(r.job.error).toBe(code);
    expect(await db.select().from(schema.projects).where(eq(schema.projects.workspaceId, r.ws))).toEqual([]);
    expect(r.deps.files.has(`${r.ws}/staging/${r.uploadId}`)).toBe(false);
  }

  it("rejects more than 500 entries before extracting", () =>
    fails(zipSync(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`f${i}`, new Uint8Array(1)]))), "bundle_too_large"));
  it("rejects a newer format version", () =>
    fails(packBundle(manifest({ version: 2 }) as never, docWith("x") as never, {}), "bundle_version_unsupported"));
  it("rejects an asset whose bytes do not match its name", () =>
    fails(packBundle(manifest() as never, docWith(`bundle:${sha(PNG)}`) as never, { [`assets/${sha(PNG)}.png`]: Buffer.from("not the png") }), "bundle_asset_mismatch"));
  it("rejects a reference with no file", () =>
    fails(packBundle(manifest({ assets: [] }) as never, docWith(`bundle:${"b".repeat(64)}`) as never, {}), "bundle_invalid"));
  it("rejects an oversized document", () =>
    fails(zipSync({ "manifest.json": strToU8(JSON.stringify(manifest({ assets: [] }))), "doc.json": new Uint8Array(5 * 1024 * 1024 + 1) }), "bundle_invalid"));
  it("rejects a file that is not a zip", () => fails(strToU8("hello"), "bundle_invalid"));

  it("stops at the plan's project limit, checked under the workspace lock", async () => {
    const ws = await makeWorkspace((await createUser()).id);
    const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Full" }).returning();
    for (let i = 0; i < 3; i++) await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: `p${i}`, kind: "screenshots", doc: docWith("x") });
    const r = await importInto(good(), "free", ws, app!.id);
    expect(r.job).toMatchObject({ status: "failed", error: "plan_limit" });
    expect(await db.select().from(schema.projects).where(eq(schema.projects.workspaceId, ws))).toHaveLength(3);
  });
});
```

Run: `pnpm --filter @chitrapx/worker exec vitest run test/bundle.test.ts` — Expected: FAIL (`runImport` not exported).

- [ ] **Step 2: `apps/worker/src/boss.ts` and the worker entry**

```ts
import { PgBoss } from "pg-boss";

/** The worker's one queue connection; handlers that queue follow-up jobs use it. */
export const boss = new PgBoss(process.env.DATABASE_URL!);
```

`apps/worker/src/index.ts`: remove `import { PgBoss } from "pg-boss";` and `const boss = new PgBoss(process.env.DATABASE_URL!);`; add `import { boss } from "./boss.ts";`.

- [ ] **Step 3: Implement `runImport`** (in `apps/worker/src/bundle.ts`)

Merge these into the file's imports: `import { createHash } from "node:crypto";`, `count` into the `drizzle-orm` import, `strFromU8, unzipSync` into the `fflate` import, `import { z } from "zod";`, `HEAD_BYTES, lockWorkspace, PLANS, reserveAndEnqueue, sniffAsset, UPLOAD_LIMITS, withTx, type Tx` into the `@chitrapx/db` import, `bundleManifestSchema, docBundleRefs, fromBundleDoc, MAX_BUNDLE_ENTRIES, MAX_DOC_BYTES` into the `@chitrapx/document` import, and `import { boss } from "./boss.ts";`. Then append:

```ts
const importInput = z.object({ appId: z.uuid(), uploadId: z.uuid(), name: z.string().trim().min(1).max(120) });
const fail = (code: string): never => { throw new FatalJobError(code); };

export type QueueRecording = (tx: Tx, workspaceId: string, assetId: string) => Promise<unknown>;
/** An imported recording still needs its free conversion before it can play. */
const queueRecording: QueueRecording = (tx, workspaceId, assetId) =>
  reserveAndEnqueue(tx, boss, { workspaceId, type: "process_recording", input: { assetId } });

type CheckedAsset = { sha256: string; kind: BundleAssetKind; mime: string; bytes: Uint8Array; width?: number; height?: number };

/** Opens and checks an untrusted .chitrapx file. Every failure is a named FatalJobError. */
async function readBundle(buf: Buffer): Promise<{ doc: ChitrapxDoc; assets: CheckedAsset[] }> {
  if (buf.byteLength > MAX_BUNDLE_BYTES) fail("bundle_too_large");
  // Sizes come from the central directory; nothing is inflated until they pass (zip bombs).
  let entries = 0, total = 0;
  try { unzipSync(new Uint8Array(buf), { filter: (f) => { entries++; total += f.originalSize; return false; } }); }
  catch { fail("bundle_invalid"); }
  if (entries > MAX_BUNDLE_ENTRIES || total > MAX_BUNDLE_BYTES) fail("bundle_too_large");
  const files = unzipSync(new Uint8Array(buf));

  let raw: unknown;
  try { raw = JSON.parse(strFromU8(files["manifest.json"] ?? fail("bundle_invalid"))); } catch (err) { if (err instanceof FatalJobError) throw err; fail("bundle_invalid"); }
  const head = raw as { format?: unknown; version?: unknown } | null;
  if (head?.format === BUNDLE_FORMAT && typeof head.version === "number" && head.version !== BUNDLE_VERSION) fail("bundle_version_unsupported");
  const parsed = bundleManifestSchema.safeParse(raw);
  if (!parsed.success) return fail("bundle_invalid");
  const manifest = parsed.data;

  const docBytes = files["doc.json"] ?? fail("bundle_invalid");
  if (docBytes.byteLength > MAX_DOC_BYTES) fail("bundle_invalid");
  let doc: ChitrapxDoc;
  try { doc = migrate(JSON.parse(strFromU8(docBytes))); } catch { return fail("bundle_invalid"); }

  const listed = new Set(manifest.assets.map((a) => a.sha256));
  if (docBundleRefs(doc).some((s) => !listed.has(s))) fail("bundle_invalid");
  const assets: CheckedAsset[] = [];
  for (const a of manifest.assets) {
    const bytes = files[`assets/${a.sha256}.${extFor(a.mime)}`] ?? fail("bundle_invalid");
    if (bytes.byteLength > UPLOAD_LIMITS[a.kind]) fail("bundle_too_large");
    if (createHash("sha256").update(bytes).digest("hex") !== a.sha256) fail("bundle_asset_mismatch");
    const sniffed = await sniffAsset(a.kind, bytes.subarray(0, HEAD_BYTES[a.kind]));
    if (!sniffed.ok || sniffed.mime !== a.mime) return fail("bundle_asset_mismatch");
    assets.push({ ...a, bytes, width: sniffed.width, height: sniffed.height });
  }
  return { doc, assets };
}

/** A .chitrapx file in this workspace's upload staging becomes a new project in `appId`. */
export async function runImport(raw: unknown, job: JobContext, deps: BundleDeps, queue: QueueRecording = queueRecording) {
  const input = importInput.parse(raw);
  const staging = `${job.workspaceId}/staging/${input.uploadId}`;
  try {
    const buf = await deps.download(staging).catch(() => fail("bundle_invalid"));
    const { doc, assets } = await readBundle(buf);

    // Content-addressed: bytes this workspace already has are not uploaded again. A rolled-back
    // import can leave an unreferenced object; the next upload of the same file replaces it.
    const have = new Set((await db.select({ sha: schema.assets.sha256 }).from(schema.assets)
      .where(and(eq(schema.assets.workspaceId, job.workspaceId), inArray(schema.assets.sha256, ["", ...assets.map((a) => a.sha256)])))).map((r) => r.sha));
    for (const a of assets) if (!have.has(a.sha256)) await deps.upload(`${job.workspaceId}/${a.sha256}`, a.bytes, a.mime, "uploads");

    const projectId = await withTx(async (tx) => {
      await lockWorkspace(tx.db, job.workspaceId);
      const [ws] = await tx.db.select({ plan: schema.workspaces.plan }).from(schema.workspaces).where(eq(schema.workspaces.id, job.workspaceId));
      const [app] = await tx.db.select({ id: schema.apps.id }).from(schema.apps)
        .where(and(eq(schema.apps.id, input.appId), eq(schema.apps.workspaceId, job.workspaceId)));
      if (!ws || !app) fail("project_missing");
      const [{ n }] = (await tx.db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, job.workspaceId))) as [{ n: number }];
      if (n >= PLANS[ws!.plan].maxProjects) fail("plan_limit");

      const idOf = new Map<string, string>();
      for (const a of assets) {
        const [inserted] = await tx.db.insert(schema.assets).values({
          workspaceId: job.workspaceId, appId: input.appId, kind: a.kind, storagePath: `${job.workspaceId}/${a.sha256}`, mime: a.mime,
          width: a.width ?? null, height: a.height ?? null, bytes: a.bytes.byteLength, sha256: a.sha256,
          meta: a.kind === "recording" ? { ready: false } : null,
        }).onConflictDoNothing().returning();
        const row = inserted ?? (await tx.db.select().from(schema.assets).where(and(eq(schema.assets.workspaceId, job.workspaceId),
          eq(schema.assets.appId, input.appId), eq(schema.assets.sha256, a.sha256))))[0]!;
        idOf.set(a.sha256, row.id);
        if (inserted && a.kind === "recording") await queue(tx, job.workspaceId, row.id);
      }
      let finalDoc: ChitrapxDoc;
      try { finalDoc = fromBundleDoc(doc, (s) => idOf.get(s)); } catch { return fail("bundle_invalid"); }
      const [project] = await tx.db.insert(schema.projects).values({
        workspaceId: job.workspaceId, appId: input.appId, name: input.name, kind: finalDoc.kind, doc: { ...finalDoc, brand: { appId: input.appId } },
      }).returning({ id: schema.projects.id });
      return project!.id;
    });
    return { actual: PRICES.project_import, output: { projectId } };
  } finally {
    await deps.remove(staging).catch(() => {});
  }
}
```

`handlers.ts`: import `runImport` and replace the placeholder with `project_import: (input, job) => runImport(input, job, bundleDeps),`.

Run: `pnpm --filter @chitrapx/worker exec vitest run test/bundle.test.ts` — Expected: PASS.

- [ ] **Step 4: Web sign and enqueue** (`apps/web/src/server/imports.ts`)

```ts
import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { db, PLANS, reserveAndEnqueue, schema, withTx } from "@chitrapx/db";
import { MAX_BUNDLE_BYTES } from "@chitrapx/document";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { HttpError } from "./http.ts";
import type { ObjectStorage } from "./storage.ts";
import { stagingPath } from "./uploads.ts";

/** Early, friendly check; the worker checks again under the workspace lock. */
async function assertProjectRoom(ctx: Ctx) {
  const [{ n }] = (await db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId))) as [{ n: number }];
  if (n >= PLANS[ctx.plan].maxProjects) throw new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxProjects} projects`);
}

/** A one-time token to upload a .chitrapx file into this workspace's staging area. */
export async function signImport(ctx: Ctx, storage: ObjectStorage, appId: string, raw: unknown) {
  await getApp(ctx, appId);
  const { size } = z.object({ size: z.number().int().positive() }).parse(raw);
  if (size > MAX_BUNDLE_BYTES) throw new HttpError(413, "too_large", "Project files can be up to 500 MB");
  await assertProjectRoom(ctx);
  const uploadId = randomUUID();
  return { uploadId, ...(await storage.signUpload(stagingPath(ctx, uploadId))) };
}

/** Free: the worker checks and imports the uploaded file. */
export async function enqueueImport(ctx: Ctx, boss: PgBoss, appId: string, raw: unknown): Promise<{ jobId: string }> {
  await getApp(ctx, appId);
  const input = z.object({ uploadId: z.uuid(), name: z.string().trim().min(1).max(120) }).parse(raw);
  await assertProjectRoom(ctx);
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "project_import", input: { appId, ...input } }));
}
```

`apps/web/src/app/api/apps/[appId]/imports/sign/route.ts`:

```ts
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { signImport } from "@/server/imports.ts";
import { supabaseStorage } from "@/server/storage.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ appId: string }> }) =>
  signImport(await requireContext(), supabaseStorage(), (await params).appId, await req.json().catch(() => ({}))));
```

`apps/web/src/app/api/apps/[appId]/imports/route.ts`:

```ts
import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { enqueueImport } from "@/server/imports.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ appId: string }> }) =>
  Response.json(await enqueueImport(await requireContext(), await getBoss(), (await params).appId, await req.json().catch(() => ({}))), { status: 201 }));
```

`apps/web/src/components/ImportProjectButton.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser.ts";
import { api } from "@/server/api.ts";
import { jobError } from "./jobText.ts";

type Job = { status: string; error: string | null; output: { projectId?: string } | null };

export function ImportProjectButton({ appId }: { appId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFile(file: File) {
    setError("");
    setBusy(true);
    try {
      const signed = await api<{ uploadId: string; path: string; token: string }>(`/api/apps/${appId}/imports/sign`, "POST", { size: file.size });
      const { error: upErr } = await createClient().storage.from("uploads").uploadToSignedUrl(signed.path, signed.token, file, { contentType: "application/zip" });
      if (upErr) throw new Error(upErr.message);
      const name = file.name.replace(/\.chitrapx$/i, "").slice(0, 120) || "Imported project";
      const { jobId } = await api<{ jobId: string }>(`/api/apps/${appId}/imports`, "POST", { uploadId: signed.uploadId, name });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await api<Job>(`/api/jobs/${jobId}`);
        if (job.status === "done" && job.output?.projectId) { router.push(`/dashboard/projects/${job.output.projectId}`); return; }
        if (job.status === "failed") { setError(jobError(job.error)); return; }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <label className={`btn-ghost cursor-pointer ${busy ? "opacity-50" : ""}`}>
        {busy ? "Importing" : "Import project"}
        <input type="file" accept=".chitrapx" className="sr-only" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
      </label>
      {error && <span role="alert" className="error text-xs">{error}</span>}
    </span>
  );
}
```

Check the browser client's export name: `grep -n "export" apps/web/src/lib/supabase/browser.ts` (UploadGrid calls `createClient()` from it). Render `<ImportProjectButton appId={...} />` in the header of `apps/web/src/app/dashboard/apps/[appId]/page.tsx` next to its existing project controls (read the file to find them; the app id variable is whatever that page already uses for links).

`jobText.ts` `MESSAGES`:

```ts
  bundle_invalid: "This is not a Chitrapx project file, or it is damaged.",
  bundle_asset_mismatch: "A screenshot or recording in this project file is damaged.",
  bundle_version_unsupported: "This project file was made by a newer version of Chitrapx.",
  plan_limit: "Your plan's project limit is reached.",
```

- [ ] **Step 5: Run all checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker apps/web
git commit -m "feat: import a .chitrapx project file into an app, checked as untrusted input"
```

---

### Task 11: End-to-end checks

**Files:**
- Modify: `apps/worker/test-e2e/export.test.ts`
- Create: `packages/assets/golden/single-amoura-02.png` (generated by the test on first run)

**Interfaces:**
- Consumes: `runExport(input, job, kind)`, `runBundle`, `runImport`, `bundleDeps`, `exportPlan`, `defaultSelection`, `fillScreenshots`.

- [ ] **Step 1: Add helpers and tests**

Add imports to `apps/worker/test-e2e/export.test.ts`: `import { createHash } from "node:crypto";`, `strFromU8` into the `fflate` import, `import sharp from "sharp";`, `defaultSelection, exportPlan, fillScreenshots, type ExportSelection, type TargetId` into the `@chitrapx/document` import, `import { runBundle, runImport } from "../src/bundle.ts";`, `import { bundleDeps } from "../src/handlers.ts";`. Add a new `describe` block at the end of the file:

```ts
const storageApi = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).storage;

/** Fails when `png` differs from packages/assets/golden/<name> in more than 0.5% of pixels; writes it when missing or UPDATE_GOLDEN is set. */
function compareGolden(name: string, png: Buffer) {
  const actual = PNG.sync.read(png);
  const refPath = join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN || !existsSync(refPath)) { writeFileSync(refPath, PNG.sync.write(actual)); return; }
  const ref = PNG.sync.read(readFileSync(refPath));
  expect([actual.width, actual.height]).toEqual([ref.width, ref.height]);
  const diff = pixelmatch(actual.data, ref.data, null, actual.width, actual.height, { threshold: 0.1 });
  expect(diff / (actual.width * actual.height)).toBeLessThan(0.005);
}

/** A workspace with 10 credits and one app. */
async function workspaceWithApp() {
  const ws = await makeWorkspace((await createUser()).id);
  await db.update(schema.workspaces).set({ plan: "pro" }).where(eq(schema.workspaces.id, ws));
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 10, reason: "adjust" });
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "E2E" }).returning();
  return { ws, appId: app!.id };
}

/** Pins the project's current document and queues an export of `selection`, as enqueueExport does. */
async function pinnedExport(ws: string, projectId: string, selection: ExportSelection, type: "export" | "export_single" = "export") {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const [v] = await db.insert(schema.projectVersions).values({ workspaceId: ws, projectId, revision: project!.revision, doc: project!.doc }).returning();
  const cost = type === "export" ? 1 : 0;
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId, type, creditsReserved: cost, input: { selection, versionId: v!.id } }).returning();
  if (cost) await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -cost, reason: "reserve", jobId: job!.id });
  return job!.id;
}

async function newProject(ws: string, appId: string, doc: ChitrapxDoc) {
  const [p] = await db.insert(schema.projects).values({ workspaceId: ws, appId, name: "E2E", kind: doc.kind, doc }).returning();
  return p!.id;
}

describe("sizes and export (SP8)", () => {
  it("exports a derived size at its exact pixels, as RGB, with report.txt", async () => {
    const doc = await templateDoc("amoura-dating");
    const { ws, appId } = await workspaceWithApp();
    const selection = { targets: [doc.groups[0]!.target, "iphone-6.5"] as TargetId[], locales: [doc.localization.baseLocale] };
    const jobId = await pinnedExport(ws, await newProject(ws, appId, doc), selection);
    await runJob(jobId, (input, job) => runExport(input, job));
    expect((await jobRow(jobId)).status).toBe("done");
    const files = await zipFiles(ws, jobId);
    const plan = exportPlan(doc, selection);
    expect(Object.keys(files).sort()).toEqual([...plan.map((p) => p.file), "report.txt"].sort());
    for (const item of plan) {
      const png = Buffer.from(files[item.file]!);
      expect(pngSize(png)).toEqual({ width: item.width, height: item.height });
      expect(png[25]).toBe(2); // IHDR colour type 2: RGB, no alpha
    }
    expect(strFromU8(files["report.txt"]!)).toContain("Sizes made from another size");
  });

  it("renders the pinned version even when the project changes during the export", async () => {
    const doc = await templateDoc("amoura-dating");
    const { ws, appId } = await workspaceWithApp();
    const projectId = await newProject(ws, appId, doc);
    const jobId = await pinnedExport(ws, projectId, defaultSelection(doc));
    await db.update(schema.projects).set({ doc: { ...doc, groups: [] }, revision: 50 }).where(eq(schema.projects.id, projectId));
    await runJob(jobId, (input, job) => runExport(input, job));
    expect((await jobRow(jobId)).status).toBe("done");
    expect(Object.keys(await zipFiles(ws, jobId))).toHaveLength(exportPlan(doc).length + 1);
  });

  it("a single PNG matches its golden image and costs nothing", async () => {
    const doc = await templateDoc("amoura-dating");
    const { ws, appId } = await workspaceWithApp();
    const g = doc.groups[0]!;
    const jobId = await pinnedExport(ws, await newProject(ws, appId, doc),
      { targets: [g.target], locales: [doc.localization.baseLocale], board: { groupId: g.id, boardIndex: 1 } }, "export_single");
    await runJob(jobId, (input, job) => runExport(input, job, "single"));
    expect((await jobRow(jobId)).status).toBe("done");
    expect(await balance(db, ws)).toBe(10);
    const { data, error } = await storageApi().from(EXPORTS_BUCKET).download(`${ws}/${jobId}.png`);
    if (error) throw error;
    compareGolden("single-amoura-02.png", Buffer.from(await data.arrayBuffer()));
  });

  it("a project file imported into another app exports identical PNGs", async () => {
    const { ws, appId } = await workspaceWithApp();
    const shot = await sharp({ create: { width: 1179, height: 2556, channels: 3, background: "#3366ff" } }).png().toBuffer();
    const hash = createHash("sha256").update(shot).digest("hex");
    await storageApi().from("uploads").upload(`${ws}/${hash}`, shot, { contentType: "image/png", upsert: true });
    const [asset] = await db.insert(schema.assets).values({ workspaceId: ws, appId, kind: "screenshot", storagePath: `${ws}/${hash}`, mime: "image/png", bytes: shot.length, sha256: hash, width: 1179, height: 2556 }).returning();
    const doc = fillScreenshots(await templateDoc("amoura-dating"), [asset!.id]);
    const sourceId = await newProject(ws, appId, doc);

    const [bundleJob] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: sourceId, type: "project_bundle", creditsReserved: 0 }).returning();
    await runJob(bundleJob!.id, (input, job) => runBundle(input, job, bundleDeps));
    expect((await jobRow(bundleJob!.id)).status).toBe("done");
    const { data: file, error } = await storageApi().from(EXPORTS_BUCKET).download(`${ws}/${bundleJob!.id}.chitrapx`);
    if (error) throw error;
    const uploadId = crypto.randomUUID();
    await storageApi().from("uploads").upload(`${ws}/staging/${uploadId}`, Buffer.from(await file.arrayBuffer()), { contentType: "application/zip" });

    const [target] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Target" }).returning();
    const [importJob] = await db.insert(schema.jobs).values({ workspaceId: ws, type: "project_import", creditsReserved: 0, input: { appId: target!.id, uploadId, name: "Copy" } }).returning();
    await runJob(importJob!.id, (input, job) => runImport(input, job, bundleDeps, async () => {}));
    const imported = await jobRow(importJob!.id);
    expect(imported.status).toBe("done");
    const copyId = (imported.output as { projectId: string }).projectId;

    const zips = [];
    for (const projectId of [sourceId, copyId]) {
      const jobId = await pinnedExport(ws, projectId, defaultSelection(doc));
      await runJob(jobId, (input, job) => runExport(input, job));
      expect((await jobRow(jobId)).status).toBe("done");
      zips.push(await zipFiles(ws, jobId));
    }
    const [a, b] = zips as [Record<string, Uint8Array>, Record<string, Uint8Array>];
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const name of Object.keys(a).filter((n) => n.endsWith(".png"))) {
      expect(Buffer.compare(Buffer.from(a[name]!), Buffer.from(b[name]!)), name).toBe(0);
    }
  }, 300_000);
});
```

`readFileSync` must be in the file's `node:fs` import (it already is). `ChitrapxDoc` is already imported as a type.

- [ ] **Step 2: Generate the new golden image and run the suite**

With `pnpm dev` running:
`pnpm --filter @chitrapx/worker exec vitest run --config vitest.e2e.config.ts -t "single PNG"` (writes `packages/assets/golden/single-amoura-02.png` on first run). Open it and confirm it is board 2 of the Amoura template at 1290×2796.
Then: `pnpm --filter @chitrapx/worker test:e2e`
Expected: PASS, including the existing golden tests.

- [ ] **Step 3: Commit**

```bash
git add apps/worker packages/assets/golden
git commit -m "test(e2e): derived sizes, pinned versions, single PNG golden, project file round trip"
```

---

## Deploy notes

- No schema migration, bucket or environment variable is added.
- Export jobs queued before the deploy run through the legacy path in `exportSource`.
