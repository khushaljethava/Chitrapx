import { describe, expect, it } from "vitest";
import type { ArtboardElement, ArtboardState, ChitrapxDoc } from "@chitrapx/document";
import { applyCommand, findElement, type Ref } from "@/editor/commands.ts";

const el = (id: string, x = 0, extra: Record<string, unknown> = {}): ArtboardElement =>
  ({ id, type: "text", name: id, position: { x, y: 10 }, size: { width: 100, height: 50 }, rotation: 0, scale: 1, content: id, fontSize: 40, fontFamily: "Inter", color: "#000", ...extra } as unknown as ArtboardElement);
const board = (id: string, elements: ArtboardElement[] = []): ArtboardState =>
  ({ id, name: id, position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, elements, backgroundColor: "#fff", zoom: 1 });
function doc(): ChitrapxDoc {
  return {
    schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] },
    groups: [{ id: "g", target: "iphone-6.9", spanElements: [el("span", 1200)], boards: [board("b1", [el("a"), el("b", 200), el("c", 400)]), board("b2", [el("d")])] }],
  };
}
const r = (elementId: string, boardId: string | null = "b1"): Ref => ({ groupId: "g", boardId, elementId });
const ids = (d: ChitrapxDoc, b = 0) => d.groups[0]!.boards[b]!.elements.map((e) => e.id);

describe("commands", () => {
  it("never mutates the input document", () => {
    const d = doc();
    const before = JSON.stringify(d);
    applyCommand(d, { type: "moveElements", refs: [r("a")], dx: 5, dy: 5 });
    expect(JSON.stringify(d)).toBe(before);
  });

  it("updateElement, moveElements (including span elements)", () => {
    let d = applyCommand(doc(), { type: "updateElement", ref: r("a"), props: { content: "Hi", rotation: 12 } as never });
    expect(findElement(d, r("a"))).toMatchObject({ content: "Hi", rotation: 12 });
    d = applyCommand(d, { type: "moveElements", refs: [r("a"), r("span", null)], dx: 10, dy: -5 });
    expect(findElement(d, r("a"))!.position).toEqual({ x: 10, y: 5 });
    expect(findElement(d, r("span", null))!.position).toEqual({ x: 1210, y: 5 });
  });

  it("add, delete, duplicate", () => {
    let d = applyCommand(doc(), { type: "addElement", groupId: "g", boardId: "b2", element: el("new") });
    expect(ids(d, 1)).toEqual(["d", "new"]);
    d = applyCommand(d, { type: "deleteElements", refs: [r("a"), r("new", "b2")] });
    expect(ids(d)).toEqual(["b", "c"]);
    expect(ids(d, 1)).toEqual(["d"]);
    d = applyCommand(d, { type: "duplicateElements", refs: [r("b")], newIds: ["b2x"], offset: 30 });
    expect(ids(d)).toEqual(["b", "b2x", "c"]);
    expect(findElement(d, r("b2x"))!.position).toEqual({ x: 230, y: 40 });
  });

  it("reorders z-order", () => {
    const d = doc();
    expect(ids(applyCommand(d, { type: "reorderElement", ref: r("a"), to: "front" }))).toEqual(["b", "c", "a"]);
    expect(ids(applyCommand(d, { type: "reorderElement", ref: r("c"), to: "back" }))).toEqual(["c", "a", "b"]);
    expect(ids(applyCommand(d, { type: "reorderElement", ref: r("a"), to: "forward" }))).toEqual(["b", "a", "c"]);
    expect(ids(applyCommand(d, { type: "reorderElement", ref: r("a"), to: "backward" }))).toEqual(["a", "b", "c"]);
  });

  it("boards: add, duplicate with fresh element ids, move, update, delete (never the last)", () => {
    let d = applyCommand(doc(), { type: "addBoard", groupId: "g", board: board("b3") });
    expect(d.groups[0]!.boards.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    d = applyCommand(d, { type: "duplicateBoard", groupId: "g", boardId: "b1", newBoardId: "b1copy", idSuffix: "x" });
    const copy = d.groups[0]!.boards[1]!;
    expect(copy.id).toBe("b1copy");
    expect(copy.elements.map((e) => e.id)).toEqual(["a-x", "b-x", "c-x"]);
    d = applyCommand(d, { type: "moveBoard", groupId: "g", boardId: "b3", toIndex: 0 });
    expect(d.groups[0]!.boards[0]!.id).toBe("b3");
    d = applyCommand(d, { type: "updateBoard", groupId: "g", boardId: "b3", props: { backgroundColor: "#123456", name: "Hero" } });
    expect(d.groups[0]!.boards[0]).toMatchObject({ backgroundColor: "#123456", name: "Hero" });
    d = applyCommand(d, { type: "deleteBoard", groupId: "g", boardId: "b3" });
    expect(d.groups[0]!.boards.map((b) => b.id)).toEqual(["b1", "b1copy", "b2"]);
    const single = { ...doc(), groups: [{ ...doc().groups[0]!, boards: [board("only")] }] };
    expect(applyCommand(single, { type: "deleteBoard", groupId: "g", boardId: "only" }).groups[0]!.boards).toHaveLength(1);
  });

  it("locale overrides: set, reset, and screenshots per locale; base untouched", () => {
    let d = applyCommand(doc(), { type: "setOverride", ref: r("a"), locale: "de-DE", props: { content: "Hallo" } });
    expect(d.groups[0]!.boards[0]!.localized).toEqual({ "de-DE": { a: { content: "Hallo", origin: "manual" } } });
    expect(findElement(d, r("a"))).toMatchObject({ content: "a" });
    d = applyCommand(d, { type: "setScreenshot", ref: r("a"), src: "asset:x", locale: "de-DE" });
    expect(d.groups[0]!.boards[0]!.localized!["de-DE"]!.a).toEqual({ content: "Hallo", origin: "manual", screenshotSrc: "asset:x" });
    d = applyCommand(d, { type: "resetOverride", ref: r("a"), locale: "de-DE", keys: ["content", "origin", "screenshotSrc"] });
    expect(d.groups[0]!.boards[0]!.localized).toEqual({});
    d = applyCommand(d, { type: "setScreenshot", ref: r("a"), src: "asset:y" });
    expect(findElement(d, r("a"))).toMatchObject({ screenshotSrc: "asset:y", screenshotRect: { left: 0, top: 0, width: 100, height: 100 } });
  });

  it("languages: add once, remove drops that language's overrides", () => {
    let d = applyCommand(doc(), { type: "addLocale", code: "fr-FR" });
    d = applyCommand(d, { type: "addLocale", code: "fr-FR" });
    d = applyCommand(d, { type: "addLocale", code: "en-US" });
    expect(d.localization.locales.map((l) => l.code)).toEqual(["de-DE", "fr-FR"]);
    d = applyCommand(d, { type: "setOverride", ref: r("a"), locale: "fr-FR", props: { content: "Salut" } });
    d = applyCommand(d, { type: "removeLocale", code: "fr-FR" });
    expect(d.localization.locales.map((l) => l.code)).toEqual(["de-DE"]);
    expect(d.groups[0]!.boards[0]!.localized?.["fr-FR"]).toBeUndefined();
  });

  it("adds another store size by retargeting a copy, and deletes a group but never the last", () => {
    let d = applyCommand(doc(), { type: "addGroupFromTarget", fromGroupId: "g", target: "ipad-13", newGroupId: "g2" });
    expect(d.groups.map((g) => [g.id, g.target])).toEqual([["g", "iphone-6.9"], ["g2", "ipad-13"]]);
    expect(d.groups[1]!.boards[0]!.size).toEqual({ width: 2064, height: 2752 });
    expect(d.groups[1]!.boards[0]!.id).not.toBe("b1");
    d = applyCommand(d, { type: "deleteGroup", groupId: "g" });
    expect(d.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(applyCommand(d, { type: "deleteGroup", groupId: "g2" }).groups).toHaveLength(1);
  });
});

describe("review fixes", () => {
  it("removing or moving a board keeps span elements on the board they started on", () => {
    const d = { ...doc(), groups: [{ ...doc().groups[0]!, boards: [board("b1"), board("b2"), board("b3")], spanElements: [el("onB3", 2 * 1290 + 100), el("onB1", 100)] }] };
    const removed = applyCommand(d, { type: "deleteBoard", groupId: "g", boardId: "b2" });
    expect(removed.groups[0]!.spanElements.find((e) => e.id === "onB3")!.position.x).toBe(1290 + 100);
    expect(removed.groups[0]!.spanElements.find((e) => e.id === "onB1")!.position.x).toBe(100);
    const moved = applyCommand(d, { type: "moveBoard", groupId: "g", boardId: "b3", toIndex: 0 });
    expect(moved.groups[0]!.spanElements.find((e) => e.id === "onB3")!.position.x).toBe(100);
    expect(moved.groups[0]!.spanElements.find((e) => e.id === "onB1")!.position.x).toBe(1290 + 100);
  });

  it("duplicating an element copies its translations to the copy", () => {
    let d = applyCommand(doc(), { type: "setOverride", ref: r("a"), locale: "de-DE", props: { content: "Hallo" } });
    d = applyCommand(d, { type: "duplicateElements", refs: [r("a")], newIds: ["a2"], offset: 10 });
    expect(d.groups[0]!.boards[0]!.localized!["de-DE"]!.a2).toEqual({ content: "Hallo", origin: "manual" });
  });
});

describe("variant sets", () => {
  it("duplicates a group as the next free variant letter of the same size", () => {
    let d = applyCommand(doc(), { type: "duplicateGroupAsVariant", groupId: "g", newGroupId: "gB" });
    d = applyCommand(d, { type: "duplicateGroupAsVariant", groupId: "g", newGroupId: "gC" });
    expect(d.groups.map((g) => [g.id, g.target, g.variant])).toEqual([["g", "iphone-6.9", undefined], ["gB", "iphone-6.9", "B"], ["gC", "iphone-6.9", "C"]]);
    expect(d.groups[1]!.boards.map((b) => b.id)).not.toEqual(d.groups[0]!.boards.map((b) => b.id));
  });
});

describe("hand-edited translations", () => {
  it("typing over a machine translation marks it manual so a later translate keeps it", () => {
    let d = applyCommand(doc(), { type: "setOverride", ref: r("a"), locale: "de-DE", props: { content: "Hallo", origin: "auto" } });
    d = applyCommand(d, { type: "setOverride", ref: r("a"), locale: "de-DE", props: { content: "Servus" } });
    expect(d.groups[0]!.boards[0]!.localized!["de-DE"]!.a).toEqual({ content: "Servus", origin: "manual" });
  });
});

describe("layers and groups", () => {
  const groupOf = (d: ChitrapxDoc, id: string) => (findElement(d, r(id)) as { groupId?: string; groupName?: string });

  it("reorderElementTo moves to an index and clamps", () => {
    expect(ids(applyCommand(doc(), { type: "reorderElementTo", ref: r("a"), toIndex: 2 }))).toEqual(["b", "c", "a"]);
    expect(ids(applyCommand(doc(), { type: "reorderElementTo", ref: r("c"), toIndex: -5 }))).toEqual(["c", "a", "b"]);
  });

  it("locks and hides several elements at once, and clears the flags", () => {
    let d = applyCommand(doc(), { type: "setElementsLocked", refs: [r("a"), r("b")], locked: true });
    expect([findElement(d, r("a")), findElement(d, r("b"))].map((e) => (e as { locked?: boolean }).locked)).toEqual([true, true]);
    d = applyCommand(d, { type: "setElementsLocked", refs: [r("a")], locked: false });
    expect("locked" in findElement(d, r("a"))!).toBe(false);
    d = applyCommand(d, { type: "setElementsHidden", refs: [r("c")], hidden: true });
    expect((findElement(d, r("c")) as { hidden?: boolean }).hidden).toBe(true);
  });

  it("groups two or more elements of one list, adjacent at the top-most member", () => {
    const d = applyCommand(doc(), { type: "groupElements", refs: [r("a"), r("c")], elementGroupId: "G", name: "Hero" });
    expect(ids(d)).toEqual(["b", "a", "c"]);
    expect(groupOf(d, "a")).toMatchObject({ groupId: "G", groupName: "Hero" });
    expect(groupOf(d, "c")).toMatchObject({ groupId: "G", groupName: "Hero" });
  });

  it("refuses fewer than two elements or elements from different lists", () => {
    const d = doc();
    expect(applyCommand(d, { type: "groupElements", refs: [r("a")], elementGroupId: "G" })).toBe(d);
    expect(applyCommand(d, { type: "groupElements", refs: [r("a"), r("d", "b2")], elementGroupId: "G" })).toBe(d);
  });

  it("ungroups, renames, and dissolves a group left with one member", () => {
    let d = applyCommand(doc(), { type: "groupElements", refs: [r("a"), r("b"), r("c")], elementGroupId: "G" });
    d = applyCommand(d, { type: "renameGroup", groupId: "g", boardId: "b1", elementGroupId: "G", name: "Cards" });
    expect(groupOf(d, "b").groupName).toBe("Cards");
    d = applyCommand(d, { type: "ungroupElements", refs: [r("a"), r("b")] });
    expect(groupOf(d, "a").groupId).toBeUndefined();
    expect(groupOf(d, "c").groupId).toBeUndefined(); // last member alone: dissolved
  });

  it("deleting all but one member dissolves the group", () => {
    let d = applyCommand(doc(), { type: "groupElements", refs: [r("a"), r("b")], elementGroupId: "G" });
    d = applyCommand(d, { type: "deleteElements", refs: [r("a")] });
    expect(groupOf(d, "b").groupId).toBeUndefined();
  });

  it("reorderElementTo can join or leave a group in the same step", () => {
    let d = applyCommand(doc(), { type: "groupElements", refs: [r("b"), r("c")], elementGroupId: "G", name: "Pair" });
    d = applyCommand(d, { type: "reorderElementTo", ref: r("a"), toIndex: 2, elementGroupId: "G" });
    expect(groupOf(d, "a")).toMatchObject({ groupId: "G", groupName: "Pair" });
    d = applyCommand(d, { type: "reorderElementTo", ref: r("a"), toIndex: 0, elementGroupId: null });
    expect(groupOf(d, "a").groupId).toBeUndefined();
  });

  it("duplicating a group makes a new group; duplicating one member makes an ungrouped copy", () => {
    let d = applyCommand(doc(), { type: "groupElements", refs: [r("a"), r("b")], elementGroupId: "G" });
    const both = applyCommand(d, { type: "duplicateElements", refs: [r("a"), r("b")], newIds: ["a2", "b2"], offset: 10 });
    expect(groupOf(both, "a2").groupId).toBe("G-a2");
    expect(groupOf(both, "b2").groupId).toBe("G-a2");
    expect(groupOf(both, "a").groupId).toBe("G");
    d = applyCommand(d, { type: "duplicateElements", refs: [r("a")], newIds: ["a3"], offset: 10 });
    expect(groupOf(d, "a3").groupId).toBeUndefined();
    expect(groupOf(d, "a").groupId).toBe("G");
  });

  it("commands that change nothing return the same document", () => {
    const d = doc();
    expect(applyCommand(d, { type: "reorderElementTo", ref: r("b"), toIndex: 1 })).toBe(d);
    expect(applyCommand(d, { type: "reorderElementTo", ref: r("c"), toIndex: 99 })).toBe(d);
    expect(applyCommand(d, { type: "reorderElementTo", ref: r("a"), toIndex: 0, elementGroupId: null })).toBe(d);
    expect(applyCommand(d, { type: "setElementsLocked", refs: [r("a"), r("b")], locked: false })).toBe(d);
    expect(applyCommand(d, { type: "setElementsHidden", refs: [r("a")], hidden: false })).toBe(d);
    expect(applyCommand(d, { type: "renameGroup", groupId: "g", boardId: "b1", elementGroupId: "nope", name: "X" })).toBe(d);
    expect(applyCommand(d, { type: "ungroupElements", refs: [r("a"), r("b")] })).toBe(d);
    const g = applyCommand(d, { type: "groupElements", refs: [r("b"), r("c")], elementGroupId: "G", name: "Pair" });
    expect(applyCommand(g, { type: "groupElements", refs: [r("b"), r("c")], elementGroupId: "G", name: "Pair" })).toBe(g);
    expect(applyCommand(g, { type: "reorderElementTo", ref: r("b"), toIndex: 1, elementGroupId: "G" })).toBe(g);
  });

  it("groups elements in the span list", () => {
    let d = applyCommand(doc(), { type: "addElement", groupId: "g", boardId: null, element: el("s2", 1500) });
    d = applyCommand(d, { type: "groupElements", refs: [r("span", null), r("s2", null)], elementGroupId: "S", name: "Wide" });
    expect(findElement(d, r("span", null))).toMatchObject({ groupId: "S", groupName: "Wide" });
    expect(findElement(d, r("s2", null))).toMatchObject({ groupId: "S", groupName: "Wide" });
  });
});

describe("applyLayoutPreset", () => {
  it("places the first text when nothing is targeted, in one step, idempotently", () => {
    const d1 = applyCommand(doc(), { type: "applyLayoutPreset", groupId: "g", boardId: "b1", preset: "text-top" });
    expect(findElement(d1, r("a"))!.position.y).toBeCloseTo(2796 * 0.06);
    expect(findElement(d1, r("b"))!.position).toEqual({ x: 200, y: 10 });
    const d2 = applyCommand(d1, { type: "applyLayoutPreset", groupId: "g", boardId: "b1", preset: "text-top" });
    expect(d2).toEqual(d1);
    expect(d2).toBe(d1);
  });
  it("places targeted elements of the preset's kind only", () => {
    const d1 = applyCommand(doc(), { type: "applyLayoutPreset", groupId: "g", boardId: "b1", preset: "text-bottom", elementIds: ["b", "c"] });
    expect(findElement(d1, r("a"))!.position).toEqual({ x: 0, y: 10 });
    expect(findElement(d1, r("c"))!.position.y).toBeCloseTo(2796 - 50 - 2796 * 0.06);
  });
});

describe("applyLayoutPreset (device)", () => {
  it("phone-tilt rotates and sizes a targeted device", () => {
    const base = doc();
    base.groups[0]!.boards[0]!.elements.push(el("p", 0, { type: "device", size: { width: 600, height: 1200 } }));
    const d1 = applyCommand(base, { type: "applyLayoutPreset", groupId: "g", boardId: "b1", preset: "phone-tilt", elementIds: ["p"] });
    const p = findElement(d1, r("p"))!;
    expect(p.rotation).toBe(-12);
    expect(p.size.height).toBeCloseTo(2796 * 0.72);
    expect(p.size.width).toBeCloseTo(2796 * 0.72 / 2);
    expect(findElement(d1, r("a"))!.position).toEqual({ x: 0, y: 10 });
  });
});

describe("apply to all", () => {
  it("copies position, size, rotation and scale to the nth counterpart on every other board", () => {
    let d = applyCommand(doc(), { type: "updateElement", ref: r("a"), props: { position: { x: 70, y: 80 }, rotation: 5 } as never });
    d = applyCommand(d, { type: "applyToAllBoards", groupId: "g", sourceRef: r("a") });
    expect(findElement(d, r("d", "b2"))).toMatchObject({ position: { x: 70, y: 80 }, rotation: 5, size: { width: 100, height: 50 }, content: "d" });
  });
  it("copies a device's screenshot crop but not its screenshot", () => {
    const dev = (id: string, rect: object, src: string) => ({ id, type: "device", deviceType: "iphone-15-pro", position: { x: 0, y: 0 }, size: { width: 10, height: 20 }, rotation: 0, scale: 1, screenshotSrc: src, screenshotRect: rect }) as never;
    let d = applyCommand(doc(), { type: "addElement", groupId: "g", boardId: "b1", element: dev("p1", { left: 5, top: 10, width: 90, height: 120 }, "asset:one") });
    d = applyCommand(d, { type: "addElement", groupId: "g", boardId: "b2", element: dev("p2", { left: 0, top: 0, width: 100, height: 100 }, "asset:two") });
    d = applyCommand(d, { type: "applyToAllBoards", groupId: "g", sourceRef: r("p1") });
    expect(findElement(d, r("p2", "b2"))).toMatchObject({ screenshotRect: { left: 5, top: 10, width: 90, height: 120 }, screenshotSrc: "asset:two" });
  });
  it("returns the same document when every counterpart already matches", () => {
    const d1 = applyCommand(doc(), { type: "applyToAllBoards", groupId: "g", sourceRef: r("a") });
    const d2 = applyCommand(d1, { type: "applyToAllBoards", groupId: "g", sourceRef: r("a") });
    expect(d2).toBe(d1);
  });
  it("re-attaches layout in every language and keeps the translated text", () => {
    let d = applyCommand(doc(), { type: "setOverride", ref: r("a"), locale: "de-DE", props: { content: "Hallo", position: { x: 9, y: 9 }, detached: ["position", "fontSize"], fontSize: 12 } as never });
    d = applyCommand(d, { type: "applyLayoutToLocales", groupId: "g", boardId: "b1" });
    const ov = d.groups[0]!.boards[0]!.localized!["de-DE"]!["a"] as Record<string, unknown>;
    expect(ov).toMatchObject({ content: "Hallo", detached: ["fontSize"], fontSize: 12 });
    expect(ov.position).toBeUndefined();
  });
  it("returns the same document when nothing is detached", () => {
    const d1 = applyCommand(doc(), { type: "setOverride", ref: r("a"), locale: "de-DE", props: { content: "Hallo" } as never });
    expect(applyCommand(d1, { type: "applyLayoutToLocales", groupId: "g", boardId: "b1" })).toBe(d1);
    const plain = doc();
    expect(applyCommand(plain, { type: "applyLayoutToLocales", groupId: "g", boardId: "b1" })).toBe(plain);
  });
});
