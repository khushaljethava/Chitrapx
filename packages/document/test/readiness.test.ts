import { describe, expect, it } from "vitest";
import { exportPlan, playSidesOk, storeReadiness, type ChitrapxDoc, type ExportSelection } from "../src/index.ts";
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

describe("storeReadiness: Google Play boundaries", () => {
  const phone = (n: number, extra: object = {}) => ({ id: "a", target: "android-phone" as const, boards: boards(n, 1080, 1920), spanElements: [], ...extra });
  const feature = { id: "f", target: "play-feature" as const, boards: boards(1, 1024, 500), spanElements: [] };
  const both = { targets: ["android-phone", "play-feature"] as ExportSelection["targets"], locales: en };
  it("accepts exactly 2 and exactly 8 phone screenshots", () => {
    expect(codes(doc([phone(2), feature]), both)).not.toContain("error:phone_count_out_of_range");
    expect(codes(doc([phone(8), feature]), both)).not.toContain("error:phone_count_out_of_range");
  });
  it("warns promo_ineligible when 4+ phone screenshots are under 1080 px", () => {
    const d = doc([phone(4), feature]);
    const plan = exportPlan(d, both).map((i) => (i.targetId === "android-phone" ? { ...i, width: 720, height: 1280 } : i));
    expect(storeReadiness(plan, d).map((i) => `${i.severity}:${i.code}`)).toEqual(["warning:promo_ineligible"]);
  });
  it("does not count A/B variant phone items toward the 2 to 8 count", () => {
    const d = doc([phone(1), phone(3, { id: "a2", variant: "B" }), feature]);
    expect(codes(d, both)).toContain("error:phone_count_out_of_range");
  });
});

describe("playSidesOk", () => {
  it("accepts in-range sizes and the boundaries", () => {
    expect(playSidesOk(1080, 1920)).toBe(true);
    expect(playSidesOk(2560, 1600)).toBe(true);
    expect(playSidesOk(320, 320)).toBe(true);
    expect(playSidesOk(3840, 3840)).toBe(true);
    expect(playSidesOk(1000, 2000)).toBe(true);
  });
  it("rejects a short side, a long side, and a ratio out of range", () => {
    expect(playSidesOk(300, 600)).toBe(false);
    expect(playSidesOk(4000, 2160)).toBe(false);
    expect(playSidesOk(1000, 2100)).toBe(false);
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

import { contentChecks } from "../src/index.ts";

describe("contentChecks: fonts", () => {
  it("warns once per family that is neither built in nor uploaded", () => {
    const b1 = board("b1", [{ ...text("t", 0, 0), fontFamily: "Gone Sans" } as never, { ...text("u", 0, 300), fontFamily: "Mine (custom)" } as never]);
    const b2 = board("b2", [{ ...text("t2", 0, 0), fontFamily: "Gone Sans" } as never]);
    b2.localized = { "de-DE": { t2: { fontFamily: "Also Gone" } } };
    const issues = contentChecks(doc([group([b1, b2])]), { customFamilies: ["Mine (custom)"] });
    expect(issues).toEqual([
      { severity: "warning", code: "font_missing", message: "Font Gone Sans is missing", groupId: "g1", boardIndex: 0 },
      { severity: "warning", code: "font_missing", message: "Font Also Gone is missing", groupId: "g1", boardIndex: 1 },
    ]);
    expect(contentChecks(doc([group([board("b", [text("t", 0, 0)])])]), { customFamilies: [] })).toEqual([]); // Inter is in the catalogue
  });
});
