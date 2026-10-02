import { describe, expect, it } from "vitest";
import { applyDesign, applyTexts, applyTranslations, textSlots } from "../src/index.ts";
import { board, device, doc, group, text } from "./fixtures.ts";

const tpl = () => doc([group([
  board("b1", [{ ...text("h1", 0, 100), content: "Track every brew", name: "headline" } as never, device("d1", 300), { ...text("stars", 0, 900), content: "★★★★★" } as never]),
  board("b2", [{ ...text("h2", 0, 100), content: "Share recipes" } as never, device("d2", 300)]),
  board("b3", [{ ...text("h3", 0, 100), content: "Join us" } as never]),
])]);
const content = (d: ReturnType<typeof tpl>, b: number, id: string) =>
  (d.groups[0]!.boards[b]!.elements.find((e) => e.id === id) as unknown as { content: string }).content;
const shot = (d: ReturnType<typeof tpl>, b: number, id: string) =>
  (d.groups[0]!.boards[b]!.elements.find((e) => e.id === id) as unknown as { screenshotSrc?: string }).screenshotSrc;

describe("textSlots", () => {
  it("lists every text slot per board with its role, text and a length budget", () => {
    const slots = textSlots(tpl());
    expect(slots[0]).toEqual([
      { id: "h1", role: "headline", text: "Track every brew", maxChars: 40 },
      { id: "stars", role: "stars", text: "★★★★★", maxChars: 40 },
    ]);
    expect(slots[2]).toEqual([{ id: "h3", role: "h3", text: "Join us", maxChars: 40 }]);
  });
});

describe("applyDesign", () => {
  it("fills screens in the planned order and writes copy only into known slots, capped in length", () => {
    const out = applyDesign(tpl(), {
      screenshotOrder: [1, 0],
      boards: [
        { boardIndex: 0, texts: [{ id: "h1", text: "  Brew better coffee  " }, { id: "d1", text: "not a text slot" }, { id: "ghost", text: "x" }] },
        { boardIndex: 1, texts: [{ id: "h2", text: "y".repeat(500) }] },
        { boardIndex: 9, texts: [{ id: "h3", text: "out of range board" }] },
      ],
    }, ["shotA", "shotB"]);
    expect(shot(out, 0, "d1")).toBe("asset:shotB");
    expect(shot(out, 1, "d2")).toBe("asset:shotA");
    expect(content(out, 0, "h1")).toBe("Brew better coffee");
    expect(content(out, 0, "stars")).toBe("★★★★★");
    expect(content(out, 1, "h2")).toHaveLength(40);
    expect(content(out, 2, "h3")).toBe("Join us");
  });

  it("repairs a bad screenshot order: drops invalid or repeated indices and appends the missing ones", () => {
    const out = applyDesign(tpl(), { screenshotOrder: [5, 1, 1, -2], boards: [] }, ["shotA", "shotB"]);
    expect(shot(out, 0, "d1")).toBe("asset:shotB");
    expect(shot(out, 1, "d2")).toBe("asset:shotA");
  });
});

describe("applyTranslations", () => {
  it("writes automatic overrides, adds the language, and never overwrites a manual edit", () => {
    let d = tpl();
    d.groups[0]!.boards[1]!.localized = { "de-DE": { h2: { content: "Rezepte teilen (von Hand)", origin: "manual" } } };
    d = applyTranslations(d, "de-DE", [{ id: "h1", text: "Jeden Brühvorgang verfolgen" }, { id: "h2", text: "Rezepte teilen" }, { id: "nope", text: "x" }]);
    expect(d.localization.locales.map((l) => l.code)).toEqual(["de-DE"]);
    expect(d.groups[0]!.boards[0]!.localized?.["de-DE"]?.h1).toEqual({ content: "Jeden Brühvorgang verfolgen", origin: "auto" });
    expect(d.groups[0]!.boards[1]!.localized?.["de-DE"]?.h2).toEqual({ content: "Rezepte teilen (von Hand)", origin: "manual" });
  });

  it("never adds the base language as a translation", () => {
    expect(applyTranslations(tpl(), "en-US", [{ id: "h1", text: "x" }]).localization.locales).toEqual([]);
  });
});

describe("applyTexts", () => {
  it("sets base text for every board that has the slot, across sizes", () => {
    const d = tpl();
    d.groups.push({ ...structuredClone(d.groups[0]!), id: "g2", target: "ipad-13" });
    const out = applyTexts(d, [{ id: "h1", text: "New" }]);
    expect(content(out, 0, "h1")).toBe("New");
    expect((out.groups[1]!.boards[0]!.elements[0] as unknown as { content: string }).content).toBe("New");
  });
});
