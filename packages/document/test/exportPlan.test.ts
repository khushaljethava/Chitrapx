import { describe, expect, it } from "vitest";
import { defaultSelection, exportBatches, exportPlan, presetSelection, resolveGroup, retarget, sourcesFor, suggestedSelection } from "../src/index.ts";
import { board, device, doc, group } from "./fixtures.ts";

const threeD = (id: string) => ({ ...device(id, 0), styleType: "3d-right" }) as unknown as ReturnType<typeof device>;

describe("exportPlan", () => {
  it("enumerates locale x board with store-shaped, zero-padded file names", () => {
    const d = { ...doc([group([board("b1", []), { ...board("b2", []), name: "Plan your Date!" }])]), localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] } };
    const plan = exportPlan(d);
    expect(plan.map((p) => p.file)).toEqual([
      "ios/iphone-6.9/en-US/01-b1.png", "ios/iphone-6.9/en-US/02-plan-your-date.png",
      "ios/iphone-6.9/de-DE/01-b1.png", "ios/iphone-6.9/de-DE/02-plan-your-date.png",
    ]);
    expect(plan[0]).toMatchObject({ sourceGroupId: "g1", targetId: "iphone-6.9", derived: false, letterboxed: false, boardIndex: 0, locale: "en-US", width: 1290, height: 2796 });
  });

  it("limits to the requested locales and ignores unknown ones", () => {
    const d = { ...doc([group([board("b1", [])])]), localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }, { code: "fr-FR" }] } };
    expect(exportPlan(d, { ...defaultSelection(d), locales: ["fr-FR", "xx-XX"] }).map((p) => p.locale)).toEqual(["fr-FR"]);
  });

  it("batches so no batch holds more than 8 3D devices, counting span elements on every board they cross", () => {
    const boards = Array.from({ length: 6 }, (_, i) => board(`b${i}`, [threeD(`d${i}a`), threeD(`d${i}b`)]));
    const batches = exportBatches(exportPlan(doc([group(boards)])), 8);
    expect(batches.map((b) => b.length)).toEqual([4, 2]);
    expect(exportBatches(exportPlan(doc([group([board("x", [])])])), 8)).toEqual([[0]]);
  });
});

describe("variants", () => {
  it("export into their own folder and only take single letters B to Z", async () => {
    const { migrate } = await import("../src/index.ts");
    const d = doc([group([board("b1", [])]), { ...group([board("b1", [])]), id: "g2", variant: "B" } as never]);
    expect(exportPlan(d).map((p) => p.file)).toEqual(["ios/iphone-6.9/en-US/01-b1.png", "ios/iphone-6.9-B/en-US/01-b1.png"]);
    expect(() => migrate(d)).not.toThrow();
    expect(migrate(d).groups[1]!.variant).toBe("B");
    expect(() => migrate(doc([{ ...group([board("b1", [])]), variant: "../x" } as never]))).toThrow();
    expect(() => migrate(doc([{ ...group([board("b1", [])]), variant: "A" } as never]))).toThrow();
  });
});

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
