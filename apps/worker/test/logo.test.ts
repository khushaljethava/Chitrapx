import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cleanLogoText } from "@chitrapx/document";
import { LOGO_PALETTES, LOGO_STYLES, logoPlan, logoSvg, renderLogo } from "../src/icons/logo.ts";
import { Rng } from "../src/icons/prng.ts";

describe("seeded generator", () => {
  it("repeats for a seed and stays in range", () => {
    const a = new Rng(42), b = new Rng(42);
    const xs = Array.from({ length: 20 }, () => a.rangeInt(3, 9));
    expect(Array.from({ length: 20 }, () => b.rangeInt(3, 9))).toEqual(xs);
    expect(xs.every((x) => x >= 3 && x < 9)).toBe(true);
    const f = new Rng(7).rangeFloat(-0.14, 0.14);
    expect(f).toBeGreaterThanOrEqual(-0.14);
    expect(f).toBeLessThan(0.14);
  });
});

describe("logo wordmark", () => {
  it("is trimmed, stripped of whitespace and cut to 4 characters", () => {
    expect(cleanLogoText("  ab c d ")).toBe("abcd");
    expect(cleanLogoText("  My App  ")).toBe("MyAp");
    expect(cleanLogoText("   ")).toBeNull();
    expect(cleanLogoText(undefined)).toBeNull();
    expect(cleanLogoText("功能")).toBe("功能");
  });

  it("escapes markup and sizes by length", () => {
    expect(logoSvg(1, "<&>")).toContain("&lt;&amp;&gt;");
    expect(logoSvg(1, "ab")).toContain('font-size="620"');
    expect(logoSvg(1, "abc")).toContain('font-size="460"');
    expect(logoSvg(1, "   ")).not.toContain("<text");
  });
});

describe("starter logo", () => {
  it("50 seeds use all 8 palettes and all 5 symbol styles", () => {
    const plans = Array.from({ length: 50 }, (_, i) => logoPlan(i + 1));
    expect(new Set(plans.map((p) => p.palette)).size).toBe(LOGO_PALETTES.length);
    expect(new Set(plans.map((p) => p.style))).toEqual(new Set(LOGO_STYLES));
  });

  it("the same seed and text give byte-identical 1024x1024 opaque PNGs", async () => {
    const a = await renderLogo(123456, "ab");
    const b = await renderLogo(123456, "ab");
    expect(a.equals(b)).toBe(true);
    const meta = await sharp(a).metadata();
    expect([meta.format, meta.width, meta.height, meta.channels]).toEqual(["png", 1024, 1024, 3]);
    expect((await renderLogo(123457, "ab")).equals(a)).toBe(false);
  });

  it("draws Chinese text with a real face, not missing-glyph boxes", async () => {
    // Private-use code points have no glyph anywhere: if Han also fell back to boxes, both renders would match.
    const han = await sharp(await renderLogo(9, "功能")).raw().toBuffer();
    const boxes = await sharp(await renderLogo(9, "")).raw().toBuffer();
    expect(han.equals(boxes)).toBe(false);
  });
});
