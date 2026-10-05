import { describe, expect, it } from "vitest";
import type { ArtboardElement, ChitrapxDoc } from "@chitrapx/document";
import { tableModel } from "@/editor/translationsModel.ts";

const info = (code: string) => ({ name: code.toUpperCase(), rtl: code === "ar-SA" });
const t = (id: string, content: string) => ({ id, type: "text", name: "", content, fontSize: 40, fontFamily: "Inter", color: "#000",
  position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, rotation: 0, scale: 1 }) as unknown as ArtboardElement;
function doc(): ChitrapxDoc {
  return {
    schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }, { code: "ar-SA" }] },
    groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [
      { id: "b1", name: "Screen 1", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
        elements: [t("h1", "Track habits"), t("s1", "Every day")], localized: { "de-DE": { h1: { content: "Gewohnheiten", origin: "auto" } } } },
      { id: "b2", name: "Screen 2", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1, elements: [t("h2", "Share")] },
    ] }],
  };
}

describe("translations table model", () => {
  it("columns carry progress and the RTL flag; rows are grouped by board", () => {
    const m = tableModel(doc(), info);
    expect(m.base).toEqual({ code: "en-US", name: "EN-US", rtl: false });
    expect(m.columns).toEqual([
      { code: "de-DE", name: "DE-DE", rtl: false, translated: 1, total: 3, stale: 0 },
      { code: "ar-SA", name: "AR-SA", rtl: true, translated: 0, total: 3, stale: 0 },
    ]);
    expect(m.sections.map((s) => [s.board, s.rows.map((r) => r.row.id)])).toEqual([["Screen 1", ["h1", "s1"]], ["Screen 2", ["h2"]]]);
    expect(m.sections[0]!.rows[0]!.cells["de-DE"]).toEqual({ text: "Gewohnheiten", state: "auto" });
  });

  it("the missing filter keeps only rows with an untranslated or stale cell", () => {
    const d = doc();
    d.localization.locales = [{ code: "de-DE" }];
    d.groups[0]!.boards[0]!.localized!["de-DE"]!.s1 = { content: "Jeden Tag", origin: "manual" };
    d.groups[0]!.boards[1]!.localized = { "de-DE": { h2: { content: "Teilen", origin: "auto", sourceHash: "00000000" } } };
    expect(tableModel(d, info, "missing").sections.flatMap((s) => s.rows.map((r) => r.row.id))).toEqual(["h2"]);
  });
});
