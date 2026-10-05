import { describe, expect, it } from "vitest";
import { statusBarSpec } from "../src/index.ts";

describe("statusBarSpec", () => {
  it("iPhones with a Dynamic Island use the iOS bar", () => {
    for (const t of ["iphone-15", "iphone-15-pro", "iphone-17-pro-max"]) expect(statusBarSpec(t)).toEqual({ platform: "ios", heightPct: 6.9 });
  });
  it("Android phones use the Android bar", () => {
    for (const t of ["android-punch-hole", "android-notch", "android-bar"]) expect(statusBarSpec(t)).toEqual({ platform: "android", heightPct: 5.9 });
  });
  it("other devices have none", () => {
    for (const t of ["ipad-pro-13", "apple-watch", "macbook", "custom", "nope"]) expect(statusBarSpec(t)).toBeNull();
  });
});
