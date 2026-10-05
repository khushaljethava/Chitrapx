import { describe, expect, it } from "vitest";
import { contentsJson } from "../src/icons/contentsJson.ts";
import { APPICONSET, iconEntries, ICON_TABLES } from "../src/icons/sizes.ts";

// launch/src/config.rs:25-143, as (expected pixel size, file name) per platform.
const LAUNCH = {
  iphone: [[180, "180.png"], [80, "80.png"], [120, "120.png"], [120, "120.png"], [57, "57.png"], [58, "58.png"], [29, "29.png"], [87, "87.png"], [114, "114.png"], [40, "40.png"], [60, "60.png"], [1024, "1024.png"]],
  ipad: [[80, "80.png"], [72, "72.png"], [152, "152.png"], [100, "100.png"], [58, "58.png"], [76, "76.png"], [29, "29.png"], [50, "50.png"], [144, "144.png"], [40, "40.png"], [167, "167.png"], [20, "20.png"], [40, "40.png"]],
  watch: [[172, "172.png"], [80, "80.png"], [88, "88.png"], [102, "102.png"], [108, "108.png"], [92, "92.png"], [100, "100.png"], [196, "196.png"], [216, "216.png"], [234, "234.png"], [258, "258.png"], [48, "48.png"], [55, "55.png"], [66, "66.png"], [87, "87.png"], [58, "58.png"], [1024, "1024.png"]],
  mac: [[128, "128.png"], [256, "256.png"], [256, "256.png"], [512, "512.png"], [32, "32.png"], [512, "512.png"], [16, "16.png"], [32, "32.png"], [64, "64.png"], [1024, "1024.png"]],
  android: [[48, "ic_launcher.png"], [72, "ic_launcher.png"], [96, "ic_launcher.png"], [144, "ic_launcher.png"], [192, "ic_launcher.png"]],
} as const;

describe("icon size tables (ported from launch)", () => {
  it("match launch entry for entry", () => {
    for (const [platform, rows] of Object.entries(LAUNCH)) {
      const entries = ICON_TABLES[platform as keyof typeof LAUNCH]("ic_launcher");
      expect(entries.map((e) => [e.pixels, e.filename]), platform).toEqual(rows);
    }
    expect(ICON_TABLES.watch("x").filter((e) => e.role).map((e) => e.role)).toContain("companionSettings");
    expect(ICON_TABLES.android("ic_launcher").map((e) => e.folder)).toEqual(["android/mipmap-mdpi/", "android/mipmap-hdpi/", "android/mipmap-xhdpi/", "android/mipmap-xxhdpi/", "android/mipmap-xxxhdpi/"]);
  });

  it("collects platforms in order, with the store icons at the root unless skipped", () => {
    const all = iconEntries(["iphone", "ipad", "watch", "mac", "android"], "ic_launcher", true);
    expect(all).toHaveLength(12 + 13 + 17 + 10 + 5 + 2);
    expect(all.filter((e) => e.store).map((e) => [e.folder, e.filename, e.pixels])).toEqual([["", "appstore.png", 1024], ["", "playstore.png", 512]]);
    expect(iconEntries(["android"], "ic_launcher", false).every((e) => e.platform === "android")).toBe(true);
    expect(iconEntries(["ipad", "ipad"], "ic_launcher", false)).toHaveLength(13);
  });

  it("only Android icons and playstore.png keep alpha", () => {
    const all = iconEntries(["iphone", "ipad", "watch", "mac", "android"], "ic_launcher", true);
    expect(all.filter((e) => !e.flatten).map((e) => e.filename)).toEqual([...Array(5).fill("ic_launcher.png"), "playstore.png"]);
  });
});

describe("Contents.json", () => {
  it("lists every Apple entry with Xcode's keys and info block", () => {
    const entries = iconEntries(["iphone", "watch", "android"], "ic_launcher", true);
    const json = JSON.parse(contentsJson(entries));
    expect(json.info).toEqual({ version: 1, author: "xcode" });
    expect(json.images).toHaveLength(12 + 17);
    expect(json.images[0]).toEqual({ size: "60x60", filename: "180.png", idiom: "iphone", scale: "3x" });
    expect(json.images.find((i: { role?: string }) => i.role === "quickLook")).toEqual({ size: "86x86", filename: "172.png", idiom: "watch", scale: "2x", role: "quickLook", subtype: "38mm" });
    expect(JSON.stringify(json)).not.toContain("expected-size");
    expect(entries.filter((e) => e.folder === APPICONSET)).toHaveLength(12 + 17);
  });
});
