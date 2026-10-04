import { describe, expect, it } from "vitest";
import type { ArtboardElement, ChitrapxDoc } from "@chitrapx/document";
import type { Ref } from "@/editor/commands.ts";
import { expandToGroups, selectableRefs } from "@/editor/selection.ts";

const el = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "text", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, content: id, fontSize: 10, fontFamily: "Inter", color: "#000", ...extra }) as unknown as ArtboardElement;
const doc = {
  schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
  groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, backgroundColor: "#fff", zoom: 1,
    elements: [el("a", { groupId: "G" }), el("b", { groupId: "G" }), el("c", { groupId: "G", locked: true }), el("d"), el("h", { hidden: true })] }] }],
} as unknown as ChitrapxDoc;
const r = (elementId: string): Ref => ({ groupId: "g", boardId: "b", elementId });

describe("selection", () => {
  it("a click on a member selects its unlocked group members", () => {
    expect(expandToGroups(doc, [r("a")]).map((x) => x.elementId)).toEqual(["a", "b"]);
  });
  it("alt-click (single) selects only the clicked element", () => {
    expect(expandToGroups(doc, [r("b")], { single: true }).map((x) => x.elementId)).toEqual(["b"]);
  });
  it("ungrouped elements select alone, without duplicates", () => {
    expect(expandToGroups(doc, [r("d"), r("d")]).map((x) => x.elementId)).toEqual(["d"]);
  });
  it("selectableRefs drops locked, hidden and missing elements", () => {
    expect(selectableRefs(doc, [r("a"), r("c"), r("h"), r("zz")]).map((x) => x.elementId)).toEqual(["a"]);
  });
});
