import { describe, expect, it } from "vitest";
import type { ChitrapxDoc } from "@chitrapx/document";
import { boardFor } from "../src/board.ts";

const el = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "shape", shapeType: "rectangle", fillColor: "#000", strokeColor: "#000", strokeWidth: 0, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, ...extra });

describe("hidden elements", () => {
  it("are not part of the rendered board, on boards or in span elements", () => {
    const doc = {
      schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
      groups: [{ id: "g", target: "iphone-6.9", spanElements: [el("s", { hidden: true })],
        boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1, elements: [el("a"), el("h", { hidden: true })] }] }],
    } as unknown as ChitrapxDoc;
    expect(boardFor(doc, "g", 0, null, (s) => s).board.elements.map((e) => e.id)).toEqual(["a"]);
  });
});

describe("brand tokens in boardFor", () => {
  it("resolve once for every render surface; unknown tokens never reach the renderer", () => {
    const doc = {
      schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
      groups: [{ id: "g", target: "iphone-6.9", spanElements: [],
        boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "brand:surface", zoom: 1,
          elements: [el("a", { fillColor: "brand:primary" }), el("c", { fillColor: "brand:accent" })] }] }],
    } as unknown as ChitrapxDoc;
    const { board } = boardFor(doc, "g", 0, null, (s) => s, { palette: { primary: "#4f46e5", surface: "#fafafa" } });
    expect(board.backgroundColor).toBe("#fafafa");
    expect((board.elements[0] as unknown as { fillColor: string }).fillColor).toBe("#4f46e5");
    expect(board.elements[1]).not.toHaveProperty("fillColor");
    expect(JSON.stringify(boardFor(doc, "g", 0, null, (s) => s).board)).not.toContain("brand:");
  });
});
