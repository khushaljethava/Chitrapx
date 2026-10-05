import { describe, expect, it } from "vitest";
import { ImportError, planCsvImport, planJsonImport, toCsv, toJson, writeTranslations, type ChitrapxDoc } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const t = (id: string, content: string, name = "") => ({ ...text(id, 0, 0), content, name }) as never;
function project(): ChitrapxDoc {
  const d = doc([group([
    board("b1", [t("h1", 'Track, every "brew"', "headline"), t("s1", "Line one\nLine two", "sub")]),
    board("b2", [t("h2", "Share recipes")]),
  ])]);
  d.groups[0]!.boards[0]!.name = "Screen 1";
  d.groups[0]!.boards[1]!.name = "Screen 2";
  d.localization.locales = [{ code: "de-DE" }, { code: "fr-FR" }];
  d.groups[0]!.boards[0]!.localized = { "de-DE": { h1: { content: 'Jeden "Brühvorgang", verfolgen', origin: "auto" }, s1: { content: "Zeile eins\nZeile zwei", origin: "manual" } } };
  d.groups[0]!.boards[1]!.localized = { "fr-FR": { h2: { content: "Partager", origin: "auto" } } };
  return d;
}
const empty = { changes: [], unchanged: 3, unknownIds: [], unknownLocales: [] };

describe("CSV", () => {
  it("is UTF-8 with a BOM, CRLF and RFC 4180 quoting, one row per text", () => {
    const csv = toCsv(project());
    expect(csv.startsWith("\uFEFFid,board,label,en-US,de-DE,fr-FR\r\n")).toBe(true);
    expect(csv).toContain('h1,Screen 1,headline,"Track, every ""brew""","Jeden ""Brühvorgang"", verfolgen",\r\n');
    expect(csv).toContain('s1,Screen 1,sub,"Line one\nLine two","Zeile eins\nZeile zwei",\r\n');
    expect(csv.endsWith("h2,Screen 2,Share recipes,Share recipes,,Partager\r\n")).toBe(true);
  });

  it("round-trips: importing what was exported changes nothing", () => {
    expect(planCsvImport(project(), toCsv(project()))).toEqual(empty);
  });

  it("two cells changed in a spreadsheet are exactly two changes, and applying them writes only those", () => {
    const d = project();
    const edited = toCsv(d).replace("Share recipes,,Partager\r\n", "Share recipes,,Partagez vos recettes\r\n")
      .replace('verfolgen",\r\ns1', 'verfolgen",Suivre chaque café\r\ns1');
    const plan = planCsvImport(d, edited);
    expect(plan.changes).toEqual([
      { locale: "fr-FR", id: "h1", text: "Suivre chaque café", from: "", label: "headline", kind: "added" },
      { locale: "fr-FR", id: "h2", text: "Partagez vos recettes", from: "Partager", label: "Share recipes", kind: "changed" },
    ]);
    expect(plan.unchanged).toBe(2);
    const out = writeTranslations(d, plan.changes);
    expect(out.groups[0]!.boards[0]!.localized!["de-DE"]).toEqual(d.groups[0]!.boards[0]!.localized!["de-DE"]);
    expect(out.groups[0]!.boards[0]!.localized!["fr-FR"]!.h1).toMatchObject({ content: "Suivre chaque café", origin: "manual" });
    expect(out.groups[0]!.boards[1]!.localized!["fr-FR"]!.h2).toMatchObject({ content: "Partagez vos recettes", origin: "manual" });
  });

  it("reports unknown ids and language columns and still imports the rest; a blank never clears", () => {
    const d = project();
    const sheet = ["id,board,label,en-US,de-DE,it", "zz9,Gone,old,Old,Alt,Vecchio", "h2,Screen 2,x,Share recipes,Teilen,Condividi", "h1,Screen 1,x,x,,"].join("\n");
    const plan = planCsvImport(d, sheet);
    expect(plan.unknownIds).toEqual(["zz9"]);
    expect(plan.unknownLocales).toEqual(["it"]);
    expect(plan.changes).toEqual([{ locale: "de-DE", id: "h2", text: "Teilen", from: "", label: "Share recipes", kind: "added" }]);
  });

  it("refuses a sheet with no id column", () => {
    expect(() => planCsvImport(project(), "board,label\nScreen 1,x")).toThrow(ImportError);
    try { planCsvImport(project(), "board,label\nScreen 1,x"); } catch (err) { expect((err as ImportError).code).toBe("no_id_column"); }
  });
});

describe("JSON", () => {
  it("is { locale: { id: text } } with the base and only translated cells, and round-trips", () => {
    const json = JSON.parse(toJson(project()));
    expect(json["en-US"]).toEqual({ h1: 'Track, every "brew"', s1: "Line one\nLine two", h2: "Share recipes" });
    expect(json["fr-FR"]).toEqual({ h2: "Partager" });
    expect(planJsonImport(project(), toJson(project()))).toEqual(empty);
  });

  it("plans changes, reports unknown ids and languages, and refuses other shapes", () => {
    const plan = planJsonImport(project(), JSON.stringify({ "de-DE": { h2: "Teilen", nope: "x" }, it: { h1: "x" } }));
    expect(plan.changes).toEqual([{ locale: "de-DE", id: "h2", text: "Teilen", from: "", label: "Share recipes", kind: "added" }]);
    expect(plan.unknownIds).toEqual(["nope"]);
    expect(plan.unknownLocales).toEqual(["it"]);
    for (const bad of ["not json", "[]", '{"de-DE":["x"]}', '{"de-DE":{"h1":3}}']) {
      expect(() => planJsonImport(project(), bad), bad).toThrow(ImportError);
    }
  });
});

it("a whitespace-only cell never clears or blanks a translation (review #1)", () => {
  const d = project();
  const sheet = ["id,board,label,en-US,de-DE,fr-FR", "h2,Screen 2,x,Share recipes,  ,   "].join("\n");
  expect(planCsvImport(d, sheet).changes).toEqual([]);
  expect(planJsonImport(d, JSON.stringify({ "fr-FR": { h2: " " } })).changes).toEqual([]);
});

it("a repeated id previews once with the last row's words (SP11 final review)", () => {
  const d = project();
  const sheet = ["id,de-DE", "h2,Rezepte", "h2,Rezepte teilen"].join("\n");
  const { changes } = planCsvImport(d, sheet);
  expect(changes.map((c) => [c.id, c.locale, c.text, c.kind])).toEqual([["h2", "de-DE", "Rezepte teilen", "added"]]);
  // A blank cell in the later row does not undo the earlier row's words.
  expect(planCsvImport(d, ["id,de-DE", "h2,Rezepte", "h2,"].join("\n")).changes.map((c) => c.text)).toEqual(["Rezepte"]);
});

it("a chip cell that differs only in spaces is unchanged, as writing it would change nothing (SP11 final review)", () => {
  const chips = { id: "c", type: "chips", name: "Chips", chips: ["Fast", "Private"], fontSize: 6, fontFamily: "Inter", fontWeight: "600",
    color: "#fff", fillColor: "#000", position: { x: 0, y: 0 }, size: { width: 480, height: 96 }, rotation: 0, scale: 1 } as never;
  let d = doc([group([board("b1", [chips])])]);
  d.localization.locales = [{ code: "de-DE" }];
  d = writeTranslations(d, [{ locale: "de-DE", id: "c#0", text: "Ganz schnell" }]);
  const plan = planCsvImport(d, ["id,de-DE", "c#0,  Ganz   schnell ", "c#1, Privat  "].join("\n"));
  expect(plan.unchanged).toBe(1);
  expect(plan.changes.map((c) => [c.id, c.text])).toEqual([["c#1", "Privat"]]);
  expect(writeTranslations(d, [{ locale: "de-DE", id: "c#0", text: "  Ganz   schnell " }])).toBe(d);
});
