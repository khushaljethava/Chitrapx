import { describe, expect, it } from "vitest";
import {
  applyTranslations, cellFor, hash32, textsIn, lengthWarning, localeProgress, translationRows, writeTranslations, type ChitrapxDoc,
} from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const t = (id: string, content: string, name?: string) => ({ ...text(id, 0, 0), content, name: name ?? "" }) as never;
function project(): ChitrapxDoc {
  const d = doc([group([
    board("b1", [t("h1", "Track every brew", "headline"), t("s1", "  "), t("x1", "Second line of copy here")]),
    board("b2", [t("h2", "Share recipes")]),
  ])]);
  d.groups[0]!.boards[0]!.name = "Screen 1";
  d.groups[0]!.boards[1]!.name = "Screen 2";
  d.localization.locales = [{ code: "de-DE" }, { code: "fr-FR" }];
  return d;
}
const withSize = (d: ChitrapxDoc) => ({ ...d, groups: [...d.groups, { ...structuredClone(d.groups[0]!), id: "g2", target: "ipad-13" as const }] });
const ov = (d: ChitrapxDoc, g: number, b: number, locale: string, id: string) => d.groups[g]!.boards[b]!.localized?.[locale]?.[id];

describe("translation rows", () => {
  it("one row per text, empty texts left out, deduplicated across sizes, labelled by name or text", () => {
    expect(translationRows(withSize(project())).map((r) => [r.id, r.board, r.label, r.base])).toEqual([
      ["h1", "Screen 1", "headline", "Track every brew"],
      ["x1", "Screen 1", "Second line of copy here", "Second line of copy here"],
      ["h2", "Screen 2", "Share recipes", "Share recipes"],
    ]);
  });

  it("cell states: untranslated, auto, manual (no origin counts as manual) and stale once the base changes", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "de-DE": { h1: { content: "Jeden Brühvorgang", origin: "auto", sourceHash: hash32("Track every brew") }, x1: { content: "Zweite Zeile" } } };
    const [h1, x1, h2] = translationRows(d);
    expect(cellFor(d, h1!, "de-DE")).toEqual({ text: "Jeden Brühvorgang", state: "auto" });
    expect(cellFor(d, x1!, "de-DE")).toEqual({ text: "Zweite Zeile", state: "manual" });
    expect(cellFor(d, h2!, "de-DE")).toEqual({ text: "", state: "untranslated" });
    (d.groups[0]!.boards[0]!.elements[0] as unknown as { content: string }).content = "Track every pour";
    expect(cellFor(d, translationRows(d)[0]!, "de-DE").state).toBe("stale-auto");
    expect(cellFor(d, translationRows(d)[1]!, "de-DE").state).toBe("manual"); // no hash: never stale
  });

  it("counts progress per language", () => {
    const d = project();
    d.groups[0]!.boards[1]!.localized = { "fr-FR": { h2: { content: "Partager", origin: "auto", sourceHash: "00000000" } } };
    expect(localeProgress(d, "fr-FR")).toEqual({ translated: 1, total: 3, stale: 1 });
    expect(localeProgress(d, "de-DE")).toEqual({ translated: 0, total: 3, stale: 0 });
  });

  it("warns when a translation is much longer than its source", () => {
    const [h1] = translationRows(project());
    expect(lengthWarning(h1!, "Jeden Brühvorgang")).toBeNull();
    expect(lengthWarning(h1!, "x".repeat(40))).toBe("Longer than the source; it may shrink or wrap");
  });
});

describe("writeTranslations", () => {
  it("writes a manual, hashed override on every board holding the id, in every size", () => {
    const out = writeTranslations(withSize(project()), [{ locale: "de-DE", id: "h1", text: "Jeden Brühvorgang" }]);
    const want = { content: "Jeden Brühvorgang", origin: "manual", sourceHash: hash32("Track every brew") };
    expect(ov(out, 0, 0, "de-DE", "h1")).toEqual(want);
    expect(ov(out, 1, 0, "de-DE", "h1")).toEqual(want);
  });

  it("'' clears back to the base; unknown and base languages are ignored; nothing to do returns the same document", () => {
    const d = writeTranslations(project(), [{ locale: "de-DE", id: "h1", text: "Jeden" }]);
    expect(ov(writeTranslations(d, [{ locale: "de-DE", id: "h1", text: "" }]), 0, 0, "de-DE", "h1")).toBeUndefined();
    expect(writeTranslations(d, [{ locale: "it", id: "h1", text: "x" }, { locale: "en-US", id: "h1", text: "x" }])).toBe(d);
    expect(writeTranslations(d, [{ locale: "de-DE", id: "h1", text: "Jeden" }])).toBe(d);
  });

  it("carries the language's own marks to the new wording and keeps detached properties", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "de-DE": { h1: { content: "Jeden Tag", marks: [{ start: 6, end: 9, fontWeight: 800 }], fontSize: 30, detached: ["fontSize"] } } };
    const out = ov(writeTranslations(d, [{ locale: "de-DE", id: "h1", text: "Jeden lieben Tag" }]), 0, 0, "de-DE", "h1")!;
    expect(out).toMatchObject({ content: "Jeden lieben Tag", marks: [{ start: 13, end: 16, fontWeight: 800 }], fontSize: 30, detached: ["fontSize"], origin: "manual" });
  });
});

describe("applyTranslations (SP11)", () => {
  it("records the source hash, keeps manual cells unless told to overwrite them", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "de-DE": { h1: { content: "Von Hand", origin: "manual" } } };
    const kept = applyTranslations(d, "de-DE", [{ id: "h1", text: "Maschine" }, { id: "h2", text: "Rezepte teilen" }]);
    expect(ov(kept, 0, 0, "de-DE", "h1")).toEqual({ content: "Von Hand", origin: "manual" });
    expect(ov(kept, 0, 1, "de-DE", "h2")).toEqual({ content: "Rezepte teilen", origin: "auto", sourceHash: hash32("Share recipes") });
    const over = applyTranslations(d, "de-DE", [{ id: "h1", text: "Maschine" }], { overwriteManual: true });
    expect(ov(over, 0, 0, "de-DE", "h1")).toEqual({ content: "Maschine", origin: "auto", sourceHash: hash32("Track every brew") });
  });

  it("from another language, a slot whose text in that language changed meanwhile is skipped", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "fr-FR": { h1: { content: "Suivre chaque café", origin: "auto" } } };
    const sources = new Map([["h1", "Suivre chaque infusion"], ["h2", "Share recipes"]]);
    const out = applyTranslations(d, "de-DE", [{ id: "h1", text: "x" }, { id: "h2", text: "Teilen" }], { sources, sourceLocale: "fr-FR" });
    expect(ov(out, 0, 0, "de-DE", "h1")).toBeUndefined();
    expect(ov(out, 0, 1, "de-DE", "h2")!.content).toBe("Teilen");
  });

  it("skipping a slot leaves no empty language map behind", () => {
    const d = project();
    d.groups[0]!.boards[1]!.localized = { "de-DE": { h2: { content: "Von Hand" } } };
    const out = applyTranslations(d, "de-DE", [{ id: "h1", text: "Verfolgen" }, { id: "h2", text: "x" }]);
    expect(out.groups[0]!.boards[1]!.localized).toEqual({ "de-DE": { h2: { content: "Von Hand" } } });
  });
});

it("hash32 is FNV-1a 32 bit, 8 hex characters", () => {
  expect(hash32("")).toBe("811c9dc5");
  expect(hash32("a")).toBe("e40c292c");
});

describe("textsIn", () => {
  it("reads a language's own text, and the base where it has none", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "fr-FR": { h1: { content: "Suivre chaque café" }, x1: { content: "  " } } };
    expect(textsIn(d, "fr-FR").filter((x) => x.text.trim())).toEqual([
      { id: "h1", text: "Suivre chaque café" }, { id: "x1", text: "Second line of copy here" }, { id: "h2", text: "Share recipes" },
    ]);
    expect(textsIn(d, "en-US").find((x) => x.id === "h1")!.text).toBe("Track every brew");
  });
});
