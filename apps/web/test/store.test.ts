import { describe, expect, it } from "vitest";
import type { ChitrapxDoc } from "@chitrapx/document";
import { createEditorStore } from "@/editor/store.ts";

const d = (): ChitrapxDoc => ({
  schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] },
  groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [
    { id: "b1", name: "b1", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#fff", zoom: 1,
      elements: [{ id: "t", type: "text", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, content: "Hi", fontSize: 10, fontFamily: "Inter", color: "#000" } as never] },
    { id: "b2", name: "b2", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#fff", zoom: 1, elements: [] },
  ] }],
});
const text = (s: ReturnType<typeof createEditorStore>) => (s.getState().doc.groups[0]!.boards[0]!.elements[0] as unknown as { content: string }).content;

describe("editor store", () => {
  it("undo restores the exact previous document and redo reapplies it", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 3 });
    const original = s.getState().doc;
    s.getState().apply({ type: "updateElement", ref: { groupId: "g", boardId: "b1", elementId: "t" }, props: { content: "Yo" } as never });
    expect(text(s)).toBe("Yo");
    expect(s.getState().dirty).toBe(true);
    s.getState().undo();
    expect(s.getState().doc).toBe(original);
    s.getState().redo();
    expect(text(s)).toBe("Yo");
  });

  it("undo of a locale override restores the override map exactly", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    const ref = { groupId: "g", boardId: "b1", elementId: "t" };
    s.getState().apply({ type: "setOverride", ref, locale: "de-DE", props: { content: "Hallo" } });
    s.getState().apply({ type: "setOverride", ref, locale: "de-DE", props: { content: "Servus" } });
    s.getState().undo();
    expect(s.getState().doc.groups[0]!.boards[0]!.localized).toEqual({ "de-DE": { t: { content: "Hallo", origin: "manual" } } });
  });

  it("a gesture is one undo step however many moves it makes", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    const ref = { groupId: "g", boardId: "b1", elementId: "t" };
    s.getState().beginGesture();
    for (let i = 0; i < 10; i++) s.getState().apply({ type: "moveElements", refs: [ref], dx: 1, dy: 0 }, { transient: true });
    s.getState().endGesture();
    expect(s.getState().doc.groups[0]!.boards[0]!.elements[0]!.position.x).toBe(10);
    s.getState().undo();
    expect(s.getState().doc.groups[0]!.boards[0]!.elements[0]!.position.x).toBe(0);
  });

  it("selection never points at removed things", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    s.getState().select([{ groupId: "g", boardId: "b1", elementId: "t" }]);
    s.getState().setActiveBoard("b1");
    s.getState().apply({ type: "deleteBoard", groupId: "g", boardId: "b1" });
    expect(s.getState().selection).toEqual([]);
    expect(s.getState().activeBoardId).toBe("b2");
  });

  it("caps history at 200 steps", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    for (let i = 0; i < 250; i++) s.getState().apply({ type: "updateBoard", groupId: "g", boardId: "b2", props: { name: `n${i}` } });
    expect(s.getState().past).toHaveLength(200);
  });
});

describe("copy variants", () => {
  it("applying a variant is one undo step", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    s.getState().apply({ type: "setTexts", texts: [{ id: "t", text: "Bold new copy" }] });
    expect(text(s)).toBe("Bold new copy");
    s.getState().undo();
    expect(text(s)).toBe("Hi");
  });
});
