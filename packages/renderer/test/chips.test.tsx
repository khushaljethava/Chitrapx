import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtboardState, ChipsElementProps } from "@chitrapx/document";
import { fontUsesOf } from "../src/fonts.tsx";
import { chipRows, ChipsElement } from "../src/osg/elements/ChipsElement";
import { projectArtboards } from "../src/osg/i18n/project";

const chips = (extra: Partial<ChipsElementProps> = {}): ChipsElementProps => ({ id: "c", type: "chips", chips: ["Fast", "Private", "Offline"], fontSize: 6, fontFamily: "Inter",
  fontWeight: "600", color: "#ffffff", fillColor: "#4f46e5", position: { x: 0, y: 0 }, size: { width: 480, height: 96 }, rotation: 0, scale: 1, ...extra });
const html = (extra: Partial<ChipsElementProps> = {}) => renderToStaticMarkup(<ChipsElement element={chips(extra)} />);

describe("ChipsElement", () => {
  it("draws one pill per chip in the box's colours and face, direction from content", () => {
    const h = html();
    expect(h.match(/<span/g)).toHaveLength(3);
    expect(h).toContain('dir="auto"');
    expect(h).toContain("background:#4f46e5");
    expect(h).toContain(">Private</span>");
    expect(h).toContain("font-size:20px");
  });

  it("cuts the box to whole rows, so a chip that would wrap past it is dropped, not overlapped", () => {
    // 6 / 0.3 = 20 px type: 38 px pills and 8 px gaps. 96 px holds two rows, 40 px holds one.
    expect(chipRows(96, 20, 8)).toBe(2);
    expect(chipRows(40, 20, 8)).toBe(1);
    expect(chipRows(10, 20, 8)).toBe(1);
    expect(html({ size: { width: 480, height: 40 } })).toContain('data-chips="" style="width:100%;height:38px;');
    expect(html()).toContain('data-chips="" style="width:100%;height:84px;');
    expect(html()).toContain("overflow:hidden");
  });

  it("aligns to the logical start, centre or end", () => {
    expect(html()).toContain("justify-content:flex-start");
    expect(html({ align: "center" })).toContain("justify-content:center");
    expect(html({ align: "right" })).toContain("justify-content:flex-end");
  });
});

describe("chips per language", () => {
  const board = (ov: Record<string, unknown>, code = "de-DE"): ArtboardState => ({ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1024, height: 500 },
    backgroundColor: "#fff", zoom: 1, elements: [chips()], localization: { baseLocale: "en-US", locales: [{ code }] }, localized: { [code]: { c: ov } } } as unknown as ArtboardState);
  const shown = (ov: Record<string, unknown>, code = "de-DE") => projectArtboards([board(ov, code)], code)[0]!.elements[0] as ChipsElementProps;

  it("a language's words replace the base chips one by one; a blank keeps the base chip", () => {
    expect(shown({ chips: ["Schnell", "", "Offline-Modus"] }).chips).toEqual(["Schnell", "Private", "Offline-Modus"]);
  });

  it("Arabic chips get the Arabic face, and the stylesheet asks for the chips' face", () => {
    expect(shown({ chips: ["سريع"] }, "ar-SA").fontFamily).toBe("Noto Sans Arabic");
    expect(fontUsesOf([{ ...board({}), elements: [chips()] }])).toEqual([{ family: "Inter", faces: [{ weight: 600, italic: false }] }]);
  });
});
