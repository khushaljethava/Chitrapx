import { describe, expect, it } from "vitest";
import { checkFont, fontFamilyFor, FontRejected, limiter, parseFont, sniffAsset, sniffFontType } from "../src/index.ts";
import { fixtureFont as font, withFsType } from "./fontFixtures.ts";

describe("sniffFontType", () => {
  it("recognises each format by its magic bytes", () => {
    expect(sniffFontType(font("inter-400.ttf"))).toEqual({ mime: "font/ttf", format: "ttf" });
    expect(sniffFontType(Buffer.from("true\0\0\0\0"))).toEqual({ mime: "font/ttf", format: "ttf" });
    expect(sniffFontType(font("source-sans-3.otf"))).toEqual({ mime: "font/otf", format: "otf" });
    expect(sniffFontType(font("inter-400.woff"))).toEqual({ mime: "font/woff", format: "woff" });
    expect(sniffFontType(font("inter-400.woff2"))).toEqual({ mime: "font/woff2", format: "woff2" });
  });
  it("rejects a renamed .exe, an SVG and empty or short input", () => {
    expect(sniffFontType(Buffer.from("MZ\x90\0\x03\0\0\0"))).toBeNull();
    expect(sniffFontType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffFontType(Buffer.alloc(0))).toBeNull();
    expect(sniffFontType(Buffer.from("wO"))).toBeNull();
  });
  it("sniffAsset uses it for the font kind", async () => {
    expect(await sniffAsset("font", font("inter-400.woff2"))).toEqual({ ok: true, mime: "font/woff2" });
    expect(await sniffAsset("font", Buffer.from("MZ\x90\0"))).toEqual({ ok: false, code: "unsupported_type" });
  });
});

describe("parseFont (fontkit in a worker thread)", () => {
  it("reads family, weight and style from the name and OS/2 tables", async () => {
    expect(await parseFont(font("inter-400.woff2"), "woff2")).toEqual({ family: "Inter", weight: 400, italic: false, format: "woff2", embeddable: true });
    expect(await parseFont(font("inter-700.woff2"), "woff2")).toMatchObject({ family: "Inter", weight: 700 });
    expect(await parseFont(font("inter-400.woff"), "woff")).toMatchObject({ family: "Inter", weight: 400 });
    expect(await parseFont(font("source-sans-3.otf"), "otf")).toMatchObject({ family: "Source Sans 3", weight: 400, italic: false });
  });
  it("marks a restricted-licence font as not embeddable, and checkFont rejects it", async () => {
    const restricted = withFsType(font("inter-400.ttf"), 0x0002);
    expect(await parseFont(restricted, "ttf")).toMatchObject({ embeddable: false });
    await expect(checkFont(restricted, "ttf")).rejects.toMatchObject({ code: "font_restricted" });
    expect(await checkFont(withFsType(font("inter-400.ttf"), 0x0008), "ttf")).toMatchObject({ embeddable: true }); // editable embedding is fine
  });
  it("rejects garbage behind valid magic bytes and runaway parses", async () => {
    await expect(parseFont(Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(100, 7)]), "woff2")).rejects.toBeInstanceOf(FontRejected);
    await expect(parseFont(font("inter-400.woff2"), "woff2", { timeoutMs: 1 })).rejects.toMatchObject({ code: "font_unreadable" });
  });
  it("suffixes families that would shadow a catalogue or system font", () => {
    expect(fontFamilyFor("Inter")).toBe("Inter (custom)");
    expect(fontFamilyFor("Arial")).toBe("Arial (custom)");
    expect(fontFamilyFor("Acme Brand Sans")).toBe("Acme Brand Sans");
  });
});

describe("limiter", () => {
  it("runs at most max calls at once, keeps going after a failure, and runs every call", async () => {
    const run = limiter(2);
    let active = 0, peak = 0;
    const job = (fail: boolean) => run(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (fail) throw new Error("boom");
      return 1;
    });
    const out = await Promise.allSettled([job(false), job(true), job(false), job(false), job(false)]);
    expect(peak).toBe(2);
    expect(out.map((o) => o.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled"]);
  });
});
