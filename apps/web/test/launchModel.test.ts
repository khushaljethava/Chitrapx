import { describe, expect, it } from "vitest";
import { collageBody, iconSourceIssue, moveItem, toggleItem } from "@/components/launchModel.ts";

describe("launch assets panel model", () => {
  it("explains why an icon source cannot be used, or warns when it is small", () => {
    expect(iconSourceIssue(1024, 1000)).toMatchObject({ blocking: true, message: expect.stringContaining("square") });
    expect(iconSourceIssue(63, 63)).toMatchObject({ blocking: true, message: expect.stringContaining("64") });
    expect(iconSourceIssue(512, 512)).toMatchObject({ blocking: false, message: expect.stringContaining("blurry") });
    expect(iconSourceIssue(1024, 1024)).toBeNull();
    expect(iconSourceIssue(null, null)).toMatchObject({ blocking: true });
  });

  it("moves an item up or down and ignores moves past the ends", () => {
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    const list = ["a", "b"];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
  });

  it("toggles a pick, appending in click order up to a limit", () => {
    expect(toggleItem(["a"], "b", 12)).toEqual(["a", "b"]);
    expect(toggleItem(["a", "b"], "a", 12)).toEqual(["b"]);
    expect(toggleItem(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });

  it("builds the collage request: automatic padding, one colour or a gradient, an optional frame", () => {
    expect(collageBody({ ids: ["x", "y"], padding: null, from: "#ffffff", to: null, device: null, fit: null }))
      .toEqual({ assetIds: ["x", "y"], background: { from: "#ffffff" } });
    expect(collageBody({ ids: ["x", "y"], padding: 24, from: "#000000", to: "#ffffff", device: "iphone-15", fit: "fit" }))
      .toEqual({ assetIds: ["x", "y"], padding: 24, background: { from: "#000000", to: "#ffffff" }, frame: { deviceType: "iphone-15", fit: "fit" } });
  });
});
