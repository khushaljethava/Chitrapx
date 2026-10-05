import { describe, expect, it } from "vitest";
import {
  aiChips, allTexts, applyChips, applyTexts, applyTranslations, cellFor, chipId, hash32, hasChips, migrate, normalizeChipOverride, normalizeChips,
  parseChipId, remapChipOverride, retarget, textsIn, translationRows, writeTranslations, type ChitrapxDoc,
} from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const chips = (list: string[]) => ({ id: "c", type: "chips", name: "Chips", chips: list, fontSize: 6, fontFamily: "Inter", fontWeight: "600",
  color: "#ffffff", fillColor: "#4f46e5", position: { x: 0, y: 0 }, size: { width: 480, height: 96 }, rotation: 0, scale: 1 }) as never;
function project(): ChitrapxDoc {
  const d = doc([{ ...group([board("fb", [{ ...text("h", 0, 0), content: "Track habits" } as never, chips(["Fast", "Private", "Offline"])], 1024, 500)]), target: "play-feature" }]);
  d.localization.locales = [{ code: "de-DE" }];
  return d;
}
const chipsOf = (d: ChitrapxDoc) => (d.groups[0]!.boards[0]!.elements.find((e) => e.type === "chips") as unknown as { chips: string[] }).chips;
const ovOf = (d: ChitrapxDoc) => d.groups[0]!.boards[0]!.localized?.["de-DE"]?.c;

describe("chip lists", () => {
  it("normalise: trimmed, capped at 24 characters, no blanks or repeats, at most six", () => {
    expect(normalizeChips(["  Fast  ", "fast", "", "x".repeat(30), "A", "B", "C", "D", "E"])).toEqual(["Fast", "x".repeat(24), "A", "B", "C", "D"]);
    expect(normalizeChips("nope")).toEqual([]);
  });

  it("a language's list keeps blanks as 'use the base chip', is cut to the base length and dropped when empty", () => {
    expect(normalizeChipOverride(["Schnell", "", "Offline", "Extra"], 3)).toEqual(["Schnell", "", "Offline"]);
    expect(normalizeChipOverride(["Schnell", "", ""], 3)).toEqual(["Schnell"]);
    expect(normalizeChipOverride(["", " "], 3)).toBeUndefined();
  });

  it("AI chips are held to two words and 16 characters", () => {
    expect(aiChips(["Brew timer", "Recipes", "Recipes", "A very long feature name", "Three word chip", 4, "Bean log"])).toEqual(["Brew timer", "Recipes", "Bean log"]);
  });

  it("chip ids round-trip, and a reorder carries each language's words", () => {
    expect(parseChipId(chipId("el-1", 3))).toEqual({ elementId: "el-1", index: 3 });
    expect(parseChipId("headline")).toBeNull();
    expect(remapChipOverride(["Schnell", "Privat", ""], [2, 0])).toEqual(["", "Schnell"]);
    expect(remapChipOverride(["Schnell", "Privat"], [0, 1, -1])).toEqual(["Schnell", "Privat"]);
    expect(remapChipOverride(undefined, [0])).toBeUndefined();
  });
});

describe("chips in the document", () => {
  it("migrate normalises the base list and each language's list", () => {
    const d = project();
    (d.groups[0]!.boards[0]!.elements[1] as unknown as { chips: string[] }).chips = [" Fast ", "fast", "Private"];
    d.groups[0]!.boards[0]!.localized = { "de-DE": { c: { chips: ["Schnell", "", "zu viel", "noch mehr"] } } };
    const out = migrate(d);
    expect(chipsOf(out)).toEqual(["Fast", "Private"]);
    expect(ovOf(out)!.chips).toEqual(["Schnell"]);
    expect(hasChips(out)).toBe(true);
  });

  it("chips are texts for AI copy and translation, one id per chip", () => {
    expect(allTexts(project())).toEqual([{ id: "h", text: "Track habits" }, { id: "c#0", text: "Fast" }, { id: "c#1", text: "Private" }, { id: "c#2", text: "Offline" }]);
    expect(chipsOf(applyTexts(project(), [{ id: "c#1", text: "Encrypted" }]))).toEqual(["Fast", "Encrypted", "Offline"]);
  });

  it("machine translation writes an automatic list hashed against the base list, and keeps a hand-written one", () => {
    const out = applyTranslations(project(), "de-DE", [{ id: "c#0", text: "Schnell" }, { id: "c#2", text: "Offline-Modus" }]);
    expect(ovOf(out)).toEqual({ chips: ["Schnell", "", "Offline-Modus"], origin: "auto", sourceHash: hash32("Fast\nPrivate\nOffline") });
    const manual = project();
    manual.groups[0]!.boards[0]!.localized = { "de-DE": { c: { chips: ["Flott"], origin: "manual" } } };
    expect(ovOf(applyTranslations(manual, "de-DE", [{ id: "c#0", text: "Schnell" }]))!.chips).toEqual(["Flott"]);
    expect(ovOf(applyTranslations(manual, "de-DE", [{ id: "c#0", text: "Schnell" }], { overwriteManual: true }))!.chips).toEqual(["Schnell"]);
  });

  it("the table has one row per chip, and a typed chip is a manual list entry", () => {
    expect(translationRows(project()).map((r) => [r.id, r.label, r.base])).toEqual([
      ["h", "h", "Track habits"], ["c#0", "Chips 1", "Fast"], ["c#1", "Chips 2", "Private"], ["c#2", "Chips 3", "Offline"],
    ]);
    const out = writeTranslations(project(), [{ locale: "de-DE", id: "c#1", text: "Privat" }]);
    expect(ovOf(out)).toEqual({ chips: ["", "Privat"], origin: "manual", sourceHash: hash32("Fast\nPrivate\nOffline") });
    expect(cellFor(out, translationRows(out)[2]!, "de-DE")).toEqual({ text: "Privat", state: "manual" });
    expect(cellFor(out, translationRows(out)[1]!, "de-DE").state).toBe("untranslated");
    expect(textsIn(out, "de-DE").find((t) => t.id === "c#1")!.text).toBe("Privat");
    expect(ovOf(writeTranslations(out, [{ locale: "de-DE", id: "c#1", text: "" }]))).toBeUndefined();
  });

  it("new chips everywhere drop the old chips' translations", () => {
    const d = applyTranslations(project(), "de-DE", [{ id: "c#0", text: "Schnell" }]);
    const out = applyChips(d, ["Brew timer", "Recipes", "Bean log", "Grind guide"]);
    expect(chipsOf(out)).toEqual(["Brew timer", "Recipes", "Bean log", "Grind guide"]);
    expect(out.groups[0]!.boards[0]!.localized).toBeUndefined();
    const none = doc([group([board("b", [])])]);
    expect(applyChips(none, ["A", "B", "C", "D"])).toBe(none);
  });

  it("retargeting scales the chips' type and gap", () => {
    const d = project();
    (d.groups[0]!.boards[0]!.elements[1] as unknown as { gap: number }).gap = 10;
    const c = retarget(d.groups[0]!, "x-post").boards[0]!.elements[1] as unknown as { fontSize: number; gap: number };
    const s = Math.min(1600 / 1024, 900 / 500);
    expect(c.fontSize).toBeCloseTo(6 * s);
    expect(c.gap).toBeCloseTo(10 * s);
  });
});
