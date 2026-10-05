import { describe, expect, it } from "vitest";
import type { ChitrapxDoc } from "@chitrapx/document";
import { nudgeSelection, shouldIgnoreKey } from "@/editor/shortcuts.ts";
import { createEditorStore } from "@/editor/store.ts";

describe("arrow-key nudge (SP11 final review)", () => {
  const d = (): ChitrapxDoc => ({
    schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "ar-SA" }, { code: "de-DE" }], mirrorRtl: true },
    groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [
      { id: "b1", name: "b1", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#fff", zoom: 1,
        elements: [{ id: "t", type: "text", position: { x: 5, y: 5 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, content: "Hi", fontSize: 10, fontFamily: "Inter", color: "#000" } as never] },
    ] }],
  }) as ChitrapxDoc;
  const x = (s: ReturnType<typeof createEditorStore>) => s.getState().doc.groups[0]!.boards[0]!.elements[0]!.position.x;
  const setup = (locale: string) => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    s.getState().select([{ groupId: "g", boardId: "b1", elementId: "t" }]);
    s.getState().setLocale(locale);
    return s;
  };

  it("moves the selection in an unmirrored view", () => {
    const s = setup("de-DE");
    expect(nudgeSelection(s, "ArrowRight", false)).toBe(true);
    expect(x(s)).toBe(6);
  });

  it("consumes the key but moves nothing in a mirrored right-to-left view, like the canvas", () => {
    const s = setup("ar-SA");
    expect(nudgeSelection(s, "ArrowRight", true)).toBe(true);
    expect(x(s)).toBe(5);
    expect(nudgeSelection(s, "a", false)).toBe(false);
  });
});

const within = (selectors: string[]) => ({ closest: (sel: string) => (selectors.includes(sel) ? {} : null) }) as unknown as EventTarget;

describe("shouldIgnoreKey", () => {
  it("ignores events another handler already consumed", () => {
    expect(shouldIgnoreKey({ defaultPrevented: true, target: null })).toBe(true);
  });
  it("handles ordinary canvas keys", () => {
    expect(shouldIgnoreKey({ defaultPrevented: false, target: null })).toBe(false);
    expect(shouldIgnoreKey({ defaultPrevented: false, target: within([]) })).toBe(false);
  });
  it("ignores keys during a layers-panel keyboard drag", () => {
    expect(shouldIgnoreKey({ defaultPrevented: false, target: within(['[aria-roledescription="sortable"][aria-pressed="true"]']) })).toBe(true);
  });
  it("ignores keys inside a modal dialog", () => {
    expect(shouldIgnoreKey({ defaultPrevented: false, target: within(['[aria-modal="true"]']) })).toBe(true);
  });
});
