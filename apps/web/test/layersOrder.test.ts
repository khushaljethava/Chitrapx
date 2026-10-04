import { describe, expect, it } from "vitest";
import { arrayIndexForPanelDrop } from "@/editor/layersOrder.ts";

// elements (back to front): a b c d  → panel (front to back): d c b a
describe("arrayIndexForPanelDrop", () => {
  const els = ["a", "b", "c", "d"];
  it("dropping to the top of the panel makes it front-most", () => {
    expect(arrayIndexForPanelDrop(["a", "d", "c", "b"], els, "a")).toBe(3);
  });
  it("dropping to the bottom makes it back-most", () => {
    expect(arrayIndexForPanelDrop(["c", "b", "a", "d"], els, "d")).toBe(0);
  });
  it("dropping between c and b puts it just in front of b", () => {
    expect(arrayIndexForPanelDrop(["c", "d", "b", "a"], els, "d")).toBe(2);
  });
});
