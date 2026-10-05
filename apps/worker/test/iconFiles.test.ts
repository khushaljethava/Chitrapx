import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { buildIconFiles, iconZip } from "../src/icons/index.ts";
import { FatalJobError } from "../src/runJob.ts";
import { ICON_PLATFORMS } from "../src/icons/sizes.ts";

const ALL = { platforms: [...ICON_PLATFORMS], androidName: "ic_launcher", includeStores: true };
const svg = (size: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`);
/** A blue disc on a transparent square. */
const transparentSource = (size = 1024) => sharp(svg(size, `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.4}" fill="#2050f0"/>`)).png().toBuffer();
/** Fully opaque red. */
const opaqueSource = (size = 1024) => sharp({ create: { width: size, height: size, channels: 4, background: "#ff0000" } }).png().toBuffer();

const channels = async (b: Uint8Array) => (await sharp(b).metadata()).channels;
const dims = async (b: Uint8Array) => { const m = await sharp(b).metadata(); return [m.width, m.height]; };
async function alphaAt(b: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3]!;
}

let files: Record<string, Uint8Array>;
beforeAll(async () => { files = (await buildIconFiles(await transparentSource(), ALL)).files; });

describe("icon files", () => {
  it("writes every Apple icon and appstore.png without alpha, Android and playstore.png with it", async () => {
    const apple = Object.keys(files).filter((f) => f.startsWith("Assets.xcassets/AppIcon.appiconset/") && f.endsWith(".png"));
    expect(apple.length).toBeGreaterThan(20);
    for (const f of [...apple, "appstore.png"]) expect(await channels(files[f]!), f).toBe(3);
    const android = Object.keys(files).filter((f) => /^android\/mipmap-[a-z]+\/.*\.png$/.test(f));
    for (const f of [...android, "playstore.png"]) {
      expect(await channels(files[f]!), f).toBe(4);
      expect(await alphaAt(files[f]!, 0, 0), f).toBe(0);
    }
    expect(await dims(files["appstore.png"]!)).toEqual([1024, 1024]);
    expect(await dims(files["playstore.png"]!)).toEqual([512, 512]);
  });

  it("Contents.json lists exactly the PNGs in its folder", () => {
    const dir = "Assets.xcassets/AppIcon.appiconset/";
    const json = JSON.parse(strFromU8(files[`${dir}Contents.json`]!));
    const listed = new Set(json.images.map((i: { filename: string }) => i.filename));
    const present = new Set(Object.keys(files).filter((f) => f.startsWith(dir) && f.endsWith(".png")).map((f) => f.slice(dir.length)));
    expect(listed).toEqual(present);
    for (const i of json.images as Array<{ size: string; scale: string; filename: string }>) {
      expect(Number(i.filename.replace(".png", ""))).toBe(Math.round(parseFloat(i.size) * parseInt(i.scale)));
    }
  });

  it("Android legacy, round and adaptive foreground icons have the exact sizes", async () => {
    const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    const fg = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
    for (const [d, px] of Object.entries(legacy)) {
      expect(await dims(files[`android/mipmap-${d}/ic_launcher.png`]!)).toEqual([px, px]);
      expect(await dims(files[`android/mipmap-${d}/ic_launcher_round.png`]!)).toEqual([px, px]);
      expect(await dims(files[`android/mipmap-${d}/ic_launcher_foreground.png`]!)).toEqual([fg[d as keyof typeof fg], fg[d as keyof typeof fg]]);
    }
  });

  it("adaptive icons: artwork inside the 66 dp safe zone, round icons masked, XML wired to the foreground and background", async () => {
    const { files: f, background } = await buildIconFiles(await opaqueSource(), { ...ALL, platforms: ["android"] });
    expect(background).toBe("#ff0000");
    const fg = f["android/mipmap-xxxhdpi/ic_launcher_foreground.png"]!;
    expect(await alphaAt(fg, Math.round(432 * 0.18), 216)).toBe(0); // safe zone starts at 21/108 = 0.194
    expect(await alphaAt(fg, Math.round(432 * 0.21), 216)).toBe(255);
    const round = f["android/mipmap-xxxhdpi/ic_launcher_round.png"]!;
    expect(await alphaAt(round, 2, 2)).toBe(0);
    expect(await alphaAt(round, 96, 96)).toBe(255);
    const xml = strFromU8(f["android/mipmap-anydpi-v26/ic_launcher.xml"]!);
    expect(xml).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>');
    expect(xml).toContain('<background android:drawable="@color/ic_launcher_background"/>');
    expect(strFromU8(f["android/mipmap-anydpi-v26/ic_launcher_round.xml"]!)).toBe(xml);
    expect(strFromU8(f["android/values/ic_launcher_background.xml"]!)).toContain('<color name="ic_launcher_background">#ff0000</color>');
  });

  it("a chosen background colour and file name are used", async () => {
    const { files: f } = await buildIconFiles(await opaqueSource(), { platforms: ["android"], androidName: "app_icon", includeStores: false, adaptiveBackground: "#123abc" });
    expect(Object.keys(f)).toContain("android/mipmap-hdpi/app_icon.png");
    expect(strFromU8(f["android/values/app_icon_background.xml"]!)).toContain("#123abc");
    expect(strFromU8(f["android/mipmap-anydpi-v26/app_icon.xml"]!)).toContain("@mipmap/app_icon_foreground");
  });

  it("transparent corners default the adaptive background to white", async () => {
    expect((await buildIconFiles(await transparentSource(256), { ...ALL, platforms: ["android"] })).background).toBe("#ffffff");
  });

  it("only android: no asset catalog; skipping stores drops both store icons", async () => {
    const { files: f } = await buildIconFiles(await opaqueSource(256), { platforms: ["android"], androidName: "ic_launcher", includeStores: false });
    expect(Object.keys(f).some((k) => k.startsWith("Assets.xcassets"))).toBe(false);
    expect(f["appstore.png"]).toBeUndefined();
    expect(f["playstore.png"]).toBeUndefined();
  });

  it("same input and options give byte-identical files and ZIP", async () => {
    const src = await transparentSource(300);
    const a = await buildIconFiles(src, ALL);
    const b = await buildIconFiles(src, ALL);
    expect(Object.keys(a.files)).toEqual(Object.keys(b.files));
    for (const k of Object.keys(a.files)) expect(Buffer.from(a.files[k]!).equals(Buffer.from(b.files[k]!)), k).toBe(true);
    expect(Buffer.from(iconZip(a.files)).equals(Buffer.from(iconZip(b.files)))).toBe(true);
    const unzipped = unzipSync(iconZip(a.files));
    expect(Object.keys(unzipped).sort()).toEqual(Object.keys(a.files).sort());
  });

  it("rejects non-square, tiny and unreadable sources; warns under 1024 px", async () => {
    const wide = await sharp({ create: { width: 1024, height: 1000, channels: 3, background: "#000" } }).png().toBuffer();
    await expect(buildIconFiles(wide, ALL)).rejects.toThrow(FatalJobError);
    await expect(buildIconFiles(wide, ALL)).rejects.toThrow("icon_not_square");
    await expect(buildIconFiles(await opaqueSource(63), ALL)).rejects.toThrow("icon_too_small");
    await expect(buildIconFiles(Buffer.from("not an image"), ALL)).rejects.toThrow("icon_unreadable");
    expect((await buildIconFiles(await opaqueSource(512), { ...ALL, platforms: ["iphone"] })).warnings).toEqual(["source_small"]);
    expect((await buildIconFiles(await opaqueSource(1024), { ...ALL, platforms: ["iphone"] })).warnings).toEqual([]);
  });
});
