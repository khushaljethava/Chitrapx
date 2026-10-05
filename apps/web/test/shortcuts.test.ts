import { describe, expect, it } from "vitest";
import { shouldIgnoreKey } from "@/editor/shortcuts.ts";

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
