import { describe, expect, it } from "vitest";
import { FONT_CATALOG, matchWeight, type ArtboardState } from "@chitrapx/document";
import { fontUsesOf, googleFontsHref } from "../src/index.ts";
import { getRecommendedFontForLanguage } from "../src/osg/lib/fontLanguageMatcher";

const text = (fontFamily: string, extra: Record<string, unknown> = {}) =>
  ({ id: `t-${fontFamily}-${JSON.stringify(extra)}`, type: "text", content: "Hi", fontSize: 40, color: "#000", fontFamily, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, ...extra });
const board = (elements: unknown[]) => ({ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, backgroundColor: "#fff", zoom: 1, elements }) as unknown as ArtboardState;

describe("Google Fonts stylesheet", () => {
  it("round-trips every catalogue family", () => {
    for (const f of FONT_CATALOG) {
      const href = googleFontsHref([{ family: f.family, faces: [{ weight: 400, italic: false }] }]);
      expect(href, f.family).toBe(`https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, "+")}:wght@${matchWeight(f.weights, 400)}&display=block`);
    }
  });
  it("requests ital,wght tuples only for families used in italic", () => {
    expect(googleFontsHref([{ family: "Playfair Display", faces: [{ weight: 700, italic: true }, { weight: 400, italic: false }] }]))
      .toBe("https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,700&display=block");
    expect(googleFontsHref([{ family: "Outfit", faces: [{ weight: 600, italic: false }] }]))
      .toBe("https://fonts.googleapis.com/css2?family=Outfit:wght@600&display=block");
  });
  it("falls back to an upright face and the nearest weight the family has", () => {
    expect(googleFontsHref([{ family: "Bebas Neue", faces: [{ weight: 700, italic: true }] }]))
      .toBe("https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400&display=block");
    expect(googleFontsHref([{ family: "Amiri", faces: [{ weight: 600, italic: false }] }])).toContain("family=Amiri:wght@700");
  });
  it("skips system, generic and non-catalogue families", () => {
    expect(googleFontsHref([{ family: "Arial", faces: [] }, { family: "sans-serif", faces: [] }, { family: "Pacifico (custom)", faces: [] }])).toBeNull();
  });
  it("collects the faces boards use", () => {
    const uses = fontUsesOf([board([text("Outfit", { fontWeight: "bold" }), text("Outfit", { fontStyle: "italic" }), text("Arial")])]);
    expect(uses).toEqual([
      { family: "Outfit", faces: [{ weight: 700, italic: false }, { weight: 400, italic: true }] },
      { family: "Arial", faces: [{ weight: 400, italic: false }] },
    ]);
  });
  it("keeps script-correct families for translations", () => {
    expect(getRecommendedFontForLanguage("ja")).toBe("Noto Sans JP");
    expect(getRecommendedFontForLanguage("ar")).toBe("Noto Sans Arabic");
  });
});
