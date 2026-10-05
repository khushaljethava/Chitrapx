import { describe, expect, it } from "vitest";
import { nextFocusIndex } from "@/components/useDialog.ts";

describe("dialog focus trap", () => {
  it("Tab wraps from the last control to the first", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });
  it("Shift+Tab wraps from the first control to the last", () => {
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });
  it("focus outside the dialog goes to the first (or last) control", () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });
  it("no focusable controls: nothing to move to", () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
  });
});
