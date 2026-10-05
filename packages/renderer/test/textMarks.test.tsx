import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtboardState, Gradient, TextElementProps } from "@chitrapx/document";
import { TextElement } from "../src/osg/elements/TextElement";
import { projectArtboards } from "../src/osg/i18n/project";

const G: Gradient = { kind: "linear", angle: 90, stops: [{ color: "#ff0000", at: 0 }, { color: "#0000ff", at: 1 }] };
const el = (extra: Partial<TextElementProps> = {}) => ({ id: "t", type: "text", content: "Track habits", fontSize: 30, color: "#111111", fontFamily: "Inter",
  position: { x: 0, y: 0 }, size: { width: 400, height: 100 }, rotation: 0, scale: 1, ...extra }) as TextElementProps;
const html = (extra: Partial<TextElementProps> = {}) => renderToStaticMarkup(<TextElement element={el(extra)} onUpdate={() => {}} isSelected={false} artboardZoom={1} />);

describe("TextElement marks", () => {
  it("renders exactly as before when there are no marks", () => {
    expect(html()).toContain(">Track habits</div>");
    expect(html()).not.toContain("<span");
  });
  it("renders styled runs as spans and leaves the rest plain", () => {
    const h = html({ marks: [{ start: 6, end: 12, fontWeight: 800, italic: true }] });
    expect(h).toContain("<span>Track </span>");
    expect(h).toContain('<span style="font-weight:800;font-style:italic">habits</span>');
  });
  it("keeps the runs in one wrapper, so the flex box wraps them as one block of text", () => {
    const h = html({ marks: [{ start: 6, end: 12, fontWeight: 800 }] });
    expect(h).toContain("<span><span>Track </span><span");
  });
  it("paints gradient runs into the glyphs, and colour runs win over a whole-box gradient", () => {
    const h = html({ gradient: G, marks: [{ start: 0, end: 5, color: "#00aa00" }, { start: 6, end: 12, gradient: G }] });
    expect(h).toContain("background-image:linear-gradient(90deg, #ff0000 0%, #0000ff 100%)");
    expect(h).toContain("background-clip:text");
    expect(h).toContain("-webkit-text-fill-color:transparent");
    expect(h).toContain('<span style="color:#00aa00;-webkit-text-fill-color:#00aa00">Track</span>');
  });
});

describe("marks per language", () => {
  const boardWith = (override: Record<string, unknown>): ArtboardState => ({
    id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: [el({ marks: [{ start: 6, end: 12, fontWeight: 800 }] })],
    localization: { baseLocale: "en-US", locales: [{ code: "de-DE", autoFit: false }] },
    localized: { "de-DE": { t: override } },
  } as unknown as ArtboardState);
  const projected = (override: Record<string, unknown>) => projectArtboards([boardWith(override)], "de-DE")[0]!.elements[0] as TextElementProps;

  it("a translation with its own wording and no marks renders unstyled", () => {
    expect(projected({ content: "Gewohnheiten verfolgen" }).marks).toBeUndefined();
  });
  it("a translation's own marks are used", () => {
    expect(projected({ content: "Gewohnheiten verfolgen", marks: [{ start: 0, end: 12, fontWeight: 800 }] }).marks).toEqual([{ start: 0, end: 12, fontWeight: 800 }]);
  });
  it("an override that keeps the base wording keeps the base marks", () => {
    expect(projected({ fontFamily: "Noto Sans", detached: ["fontFamily"] }).marks).toEqual([{ start: 6, end: 12, fontWeight: 800 }]);
  });
});

describe("text case", () => {
  it("is drawn with text-transform, leaving the content alone", () => {
    expect(html({ textTransform: "uppercase" })).toContain("text-transform:uppercase");
    expect(html({ textTransform: "uppercase" })).toContain(">Track habits</div>");
  });
});
