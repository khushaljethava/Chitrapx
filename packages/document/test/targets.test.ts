import { describe, expect, it } from "vitest";
import { getTarget, TARGETS, targetForSize } from "../src/index.ts";

describe("targets", () => {
  it("every target has a unique id and a slot", () => {
    expect(new Set(TARGETS.map((t) => t.id)).size).toBe(TARGETS.length);
    for (const t of TARGETS) expect(t.slot, t.id).toMatch(/^[a-z0-9.-]+$/);
  });

  it("adds the missing store sizes in their slots", () => {
    expect(getTarget("iphone-6.9-1320")).toMatchObject({ slot: "ios-6.9", width: 1320, height: 2868 });
    expect(getTarget("iphone-6.1")).toMatchObject({ slot: "ios-6.1", width: 1170, height: 2532 });
    expect(getTarget("ipad-11")).toMatchObject({ slot: "ipad-11", width: 1668, height: 2388 });
    expect(getTarget("android-tablet-10-land")).toMatchObject({ slot: "android-tablet-10", width: 2560, height: 1600 });
    expect(getTarget("apple-tv-4k")).toMatchObject({ slot: "tv", width: 3840, height: 2160 });
    expect(getTarget("watch-s3")).toMatchObject({ slot: "watch", width: 312, height: 390 });
    expect(getTarget("app-preview-landscape")).toMatchObject({ slot: "preview", width: 1920, height: 886 });
    expect(getTarget("ipad-12.9")!.slot).toBe("ipad-13");
  });

  it("keeps template boards on their existing target", () => {
    expect(targetForSize(1290, 2796).id).toBe("iphone-6.9");
    expect(targetForSize(1320, 2868).id).toBe("iphone-6.9-1320");
    expect(targetForSize(3840, 2160).id).toBe("vision-pro");
  });

  it("offers the 1320 px 6.9-inch size first", () => {
    expect(TARGETS[0]!.id).toBe("iphone-6.9-1320");
  });
});
