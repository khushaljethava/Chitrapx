import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtboardElement, ArtboardState, ChitrapxDoc, TextElementProps } from "@chitrapx/document";
import { boardFor } from "../src/board.ts";
import { fontUsesOf, googleFontsHref } from "../src/fonts.tsx";
import { TextElement } from "../src/osg/elements/TextElement";
import { mirrorsLocale, projectArtboards, unprojectArtboards } from "../src/osg/i18n/project";

const text = (id: string, x: number, extra: Partial<TextElementProps> = {}) => ({ id, type: "text", content: "Track habits", fontSize: 30, color: "#111111", fontFamily: "Inter",
  textAlign: "left", lineHeight: 1.1, position: { x, y: 100 }, size: { width: 400, height: 200 }, rotation: 0, scale: 1, ...extra }) as TextElementProps;
const device = { id: "d", type: "device", deviceType: "iphone-15", position: { x: 40, y: 400 }, size: { width: 500, height: 1000 }, rotation: 8, scale: 1 } as unknown as ArtboardElement;
const loc = (mirrorRtl?: boolean) => ({
  baseLocale: "en-US", locales: [{ code: "ar-SA", autoFit: false }, { code: "de-DE", autoFit: false }, { code: "he", autoFit: false }], ...(mirrorRtl ? { mirrorRtl } : {}),
});
const board = (mirrorRtl?: boolean, localized?: ArtboardState["localized"]): ArtboardState => ({
  id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
  elements: [device, text("t", 800)], localization: loc(mirrorRtl), ...(localized ? { localized } : {}),
});
const at = (b: ArtboardState, id: string) => b.elements.find((e) => e.id === id)!;

describe("mirrored layout (SP11)", () => {
  it("only an RTL language of a project that opted in is mirrored; the rest come back by reference", () => {
    const on = [board(true)];
    expect(projectArtboards(on, "en-US")).toBe(on);
    expect(projectArtboards(on, "de-DE")).toBe(on);
    const off = [board()];
    expect(projectArtboards(off, "ar-SA")).toBe(off);
    expect(mirrorsLocale(on[0]!.localization, "ar-SA")).toBe(true);
    expect(mirrorsLocale(on[0]!.localization, "de-DE")).toBe(false);
    expect(mirrorsLocale(off[0]!.localization, "ar-SA")).toBe(false);
  });

  it("swaps a device on the left and text on the right, and tilts the other way", () => {
    const [b] = projectArtboards([board(true)], "ar-SA");
    expect(at(b!, "d").position).toEqual({ x: 1290 - 40 - 500, y: 400 });
    expect(at(b!, "d").rotation).toBe(-8);
    expect(at(b!, "t").position).toEqual({ x: 1290 - 800 - 400, y: 100 });
    expect(at(b!, "t").rotation).toBe(0);
    expect(at(projectArtboards([board(true)], "he")[0]!, "d").position.x).toBe(750);
  });

  it("counts the element's scale, and leaves a position this language holds itself alone", () => {
    const scaled = { ...board(true), elements: [{ ...device, scale: 0.5 }] } as ArtboardState;
    expect(projectArtboards([scaled], "ar-SA")[0]!.elements[0]!.position.x).toBe(1290 - 40 - 250);
    const held = board(true, { "ar-SA": { d: { position: { x: 10, y: 20 }, detached: ["position"] } } });
    expect(at(projectArtboards([held], "ar-SA")[0]!, "d").position).toEqual({ x: 10, y: 20 });
  });

  it("a mirrored view is never written back into the base", () => {
    const base = [board(true)];
    expect(unprojectArtboards(base, "ar-SA", projectArtboards(base, "ar-SA"))).toBe(base);
  });

  it("boardFor mirrors exports and previews too", () => {
    const d = { schemaVersion: 1, kind: "screenshots", localization: loc(true),
      groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ ...board(), localization: undefined }] }] } as unknown as ChitrapxDoc;
    expect(boardFor(d, "g", 0, "ar-SA", (s) => s).board.elements.find((e) => e.id === "d")!.position.x).toBe(750);
    expect(boardFor(d, "g", 0, "en-US", (s) => s).board.elements.find((e) => e.id === "d")!.position.x).toBe(40);
  });
});

describe("scripts (SP11)", () => {
  const withText = (code: string, content: string, ov: Record<string, unknown> = {}) => {
    const b = { ...board(), localization: { baseLocale: "en-US", locales: [{ code, autoFit: false }] }, localized: { [code]: { t: { content, ...ov } } } } as ArtboardState;
    return at(projectArtboards([b], code)[0]!, "t") as TextElementProps;
  };

  it("Arabic and Hebrew text gets a face with the glyphs, and the board stylesheet asks for it", () => {
    const ar = withText("ar-SA", "هل أنت مستعد؟");
    expect(ar.fontFamily).toBe("Noto Sans Arabic");
    expect(withText("he", "מוכנים?").fontFamily).toBe("Noto Sans Hebrew");
    expect(googleFontsHref(fontUsesOf([{ ...board(), elements: [ar] }]))).toContain("family=Noto+Sans+Arabic");
  });

  it("Arabic and Urdu get more leading than Latin; a detached line height wins; other languages are untouched", () => {
    expect(withText("ar-SA", "مرحبا").lineHeight).toBe(1.3);
    expect(withText("ur", "خوش آمدید").lineHeight).toBe(1.8);
    expect(withText("ar-SA", "مرحبا", { lineHeight: 1.05, detached: ["lineHeight"] }).lineHeight).toBe(1.05);
    expect(withText("de-DE", "Hallo").lineHeight).toBe(1.1);
  });

  it("text takes its direction from its content and aligns to the side it starts on", () => {
    const html = renderToStaticMarkup(<TextElement element={text("t", 0, { content: "هل أنت مستعد لـ Bloom؟ 2026" })} onUpdate={() => {}} isSelected={false} artboardZoom={1} />);
    expect(html).toContain('dir="auto"');
    expect(html).toContain("text-align:start");
    expect(html).toContain("justify-content:flex-start");
  });
});
