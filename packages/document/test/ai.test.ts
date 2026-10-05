import { describe, expect, it } from "vitest";
import { applyChips, applyDesign, competitorEchoes, applyTexts, applyTranslations, hash32, textSlots, withFeatureGraphic, type ChitrapxDoc } from "../src/index.ts";
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
    expect(d.groups[0]!.boards[0]!.localized?.["de-DE"]?.h1).toEqual({ content: "Jeden Brühvorgang verfolgen", origin: "auto", sourceHash: hash32("Track every brew") });
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

describe("review fixes", () => {
  it("screenshotsPerBoard follows fillScreenshots: boards without devices get none, two devices get two", async () => {
    const { screenshotsPerBoard } = await import("../src/index.ts");
    const d = doc([group([board("b0", []), board("b1", [device("r", 700), device("l", 100)]), board("b2", [device("x", 300)])])]);
    expect(screenshotsPerBoard(d, 2)).toEqual([[], [0, 1], []]);
    expect(screenshotsPerBoard(d, 5)).toEqual([[], [0, 1], [2]]);
  });

  it("caps translated text to the slot budget", () => {
    const out = applyTranslations(tpl(), "de-DE", [{ id: "h3", text: "z".repeat(1000) }]);
    expect(out.groups[0]!.boards[2]!.localized!["de-DE"]!.h3!.content).toHaveLength(40);
  });

  it("skips a translation whose source text changed since the job read it", () => {
    const d = tpl();
    const sources = new Map([["h1", "Track every brew"], ["h2", "Old wording"]]);
    const out = applyTranslations(d, "de-DE", [{ id: "h1", text: "Verfolgen" }, { id: "h2", text: "Veraltet" }], { sources });
    expect(out.groups[0]!.boards[0]!.localized!["de-DE"]!.h1!.content).toBe("Verfolgen");
    expect(out.groups[0]!.boards[1]!.localized?.["de-DE"]?.h2).toBeUndefined();
  });
});

describe("AI text keeps styling on the right letters (SP10 review I1, I2)", () => {
  const styled = () => {
    const d = doc([group([board("b1", [{ ...text("t", 0, 0), content: "Track your habits", marks: [{ start: 11, end: 17, fontWeight: 800 }] } as never])])]);
    d.localization.locales = [{ code: "de-DE" }];
    return d;
  };
  const marksOf = (d: ChitrapxDoc) => (d.groups[0]!.boards[0]!.elements[0] as unknown as { marks?: unknown }).marks;

  it("applyTexts carries marks across the edit instead of leaving old offsets", () => {
    expect(marksOf(applyTexts(styled(), [{ id: "t", text: "Sleep better tonight" }]))).toBeUndefined();
    expect(marksOf(applyTexts(styled(), [{ id: "t", text: "Track all your habits" }]))).toEqual([{ start: 15, end: 21, fontWeight: 800 }]);
  });

  it("re-translating drops a language's marks that belonged to the old wording", () => {
    const d = styled();
    d.groups[0]!.boards[0]!.localized = { "de-DE": { t: { content: "Gewohnheiten", origin: "auto", marks: [{ start: 0, end: 12, italic: true }] } } };
    const out = applyTranslations(d, "de-DE", [{ id: "t", text: "Neue Routinen" }]);
    expect(out.groups[0]!.boards[0]!.localized!["de-DE"]!.t).not.toHaveProperty("marks");
  });
});

describe("feature graphic for Play (SP11)", () => {
  const fg = () => doc([{ id: "fgx", target: "play-feature", spanElements: [], boards: [board("fb", [
    { ...text("t1", 0, 0), content: "Sample" } as never,
    { id: "c", type: "chips", chips: ["A", "B"], fontSize: 6, fontFamily: "Inter", color: "#fff", fillColor: "#000", position: { x: 0, y: 0 }, size: { width: 400, height: 90 }, rotation: 0, scale: 1 } as never,
  ], 1024, 500)] }]);

  it("appends the feature graphic size with prefixed ids and its own copy, once", () => {
    const out = withFeatureGraphic(tpl(), fg(), [{ id: "t1", text: "  Brew better  " }, { id: "ghost", text: "x" }]);
    const g = out.groups.at(-1)!;
    expect(g).toMatchObject({ id: "fg-fgx", target: "play-feature" });
    expect(g.boards[0]!.id).toBe("fg-fb");
    expect(g.boards[0]!.elements.map((e) => e.id)).toEqual(["fg-t1", "fg-c"]);
    expect((g.boards[0]!.elements[0] as unknown as { content: string }).content).toBe("Brew better");
    expect(withFeatureGraphic(out, fg(), [])).toBe(out);
    expect(applyChips(out, ["Timer", "Recipes", "Log", "Guide"]).groups.at(-1)!.boards[0]!.elements[1]).toMatchObject({ chips: ["Timer", "Recipes", "Log", "Guide"] });
  });
});

it("competitorEchoes catches a repeated headline of three or more words, case and punctuation aside", () => {
  expect(competitorEchoes("Track every habit you have!", ["track every habit you have"])).toBe(true);
  expect(competitorEchoes("Build habits that stick", ["Track every habit you have"])).toBe(false);
  expect(competitorEchoes("Fast. Private.", ["Fast"])).toBe(false);
});
