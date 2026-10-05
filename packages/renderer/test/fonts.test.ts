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

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BoardFonts, cssFontFamily, customFontFaceCss, type CustomFontFace } from "../src/index.ts";

const face = (over: Partial<CustomFontFace> = {}): CustomFontFace => ({ family: "Acme Sans", weight: 400, italic: false, format: "woff2", url: "https://s3.example/u/w/abc?X-Amz-Signature=1", ...over });

describe("uploaded font faces", () => {
  it("writes one @font-face per face with block display", () => {
    expect(customFontFaceCss([face(), face({ weight: 700, italic: true, format: "ttf" })])).toBe(
      '@font-face{font-family:"Acme Sans";src:url("https://s3.example/u/w/abc?X-Amz-Signature=1") format("woff2");font-weight:400;font-style:normal;font-display:block}\n' +
      '@font-face{font-family:"Acme Sans";src:url("https://s3.example/u/w/abc?X-Amz-Signature=1") format("truetype");font-weight:700;font-style:italic;font-display:block}');
  });
  it("cannot be broken out of by a hostile family name or URL", () => {
    const css = customFontFaceCss([face({ family: 'Evil"}</style><script>x', url: 'https://x/"); background:url(//evil' })]);
    expect(css).not.toContain("</style>");
    expect(css).toContain('font-family:"Evil\\"}\\3c /style>\\3c script>x"');
    expect(css).toContain('src:url("https://x/\\"); background:url(//evil")');
  });
  it("BoardFonts declares only the uploaded faces the boards use", () => {
    const html = renderToStaticMarkup(createElement(BoardFonts, { boards: [board([text("Acme Sans")])], faces: [face(), face({ family: "Unused Co" })] }));
    expect(html).toContain("Acme Sans");
    expect(html).not.toContain("Unused Co");
  });
  it("a missing family falls back to a generic family instead of the page default", () => {
    expect(cssFontFamily("Acme Sans")).toBe('"Acme Sans", sans-serif');
    expect(cssFontFamily("Playfair Display")).toBe('"Playfair Display", serif');
  });
});
