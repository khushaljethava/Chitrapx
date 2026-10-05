import { describe, expect, it } from "vitest";
import { applyStyle, catalogFont, contrastRatio, matchWeight, migrate, STYLE_FIELDS, STYLES, type ChitrapxDoc } from "../src/index.ts";
import { board, device, doc, group, text } from "./fixtures.ts";

const sample = (): ChitrapxDoc => {
  const b1 = board("b1", [{ ...text("h", 0, 100), content: "Track habits", marks: [{ start: 0, end: 5, fontWeight: 800 }] } as never, { ...text("s", 0, 600), fontSize: 30 } as never, device("d", 300, "asset:00000000-0000-0000-0000-000000000001")]);
  b1.localized = { "de-DE": { h: { content: "Gewohnheiten" } } };
  const d = doc([group([b1, board("b2", [text("h2", 0, 100)])])]);
  d.localization.locales = [{ code: "de-DE" }];
  return migrate(d);
};
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const styleFields = (d: ChitrapxDoc) => d.groups[0]!.boards.map((b) => ({
  board: pick(b as never, STYLE_FIELDS.board),
  els: b.elements.map((e) => pick(e as never, e.type === "text" ? STYLE_FIELDS.text : STYLE_FIELDS.device)),
}));

describe("named styles", () => {
  it("ships 18 with unique ids", () => {
    expect(STYLES).toHaveLength(18);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(18);
  });
  it("every headline colour reads on its background (4.5:1, gradients at their worst stop)", () => {
    for (const s of STYLES) {
      const bgs = "gradient" in s.background ? s.background.gradient.stops.map((x) => x.color) : [s.background.color];
      expect(Math.min(...bgs.map((bg) => contrastRatio(s.palette.text, bg)!)), s.id).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("uses only catalogue fonts, in weights they have", () => {
    for (const s of STYLES) {
      for (const [family, weight] of [[s.fonts.heading, s.headline.weight], [s.fonts.body, s.body.weight]] as const) {
        const f = catalogFont(family);
        expect(f, `${s.id}: ${family}`).toBeDefined();
        expect(matchWeight(f!.weights, weight), `${s.id}: ${family} ${weight}`).toBe(weight);
      }
    }
  });
  it("applying twice equals applying once", () => {
    for (const s of STYLES) {
      const once = applyStyle(sample(), "g1", s.id);
      expect(applyStyle(once, "g1", s.id), s.id).toBe(once);
    }
  });
  it("applying B after A equals applying B alone, on every style field", () => {
    for (const a of STYLES) {
      const b = STYLES[(STYLES.indexOf(a) + 7) % STYLES.length]!;
      expect(styleFields(applyStyle(applyStyle(sample(), "g1", a.id), "g1", b.id)), `${a.id} then ${b.id}`).toEqual(styleFields(applyStyle(sample(), "g1", b.id)));
    }
  });
  it("sets the background, headline, body and device treatment, and the group's styleId", () => {
    const out = applyStyle(sample(), "g1", "swiss-grid-bold");
    const b = out.groups[0]!.boards[0]!;
    expect(out.groups[0]!.styleId).toBe("swiss-grid-bold");
    expect(b).toMatchObject({ backgroundType: "solid", backgroundColor: "#F2F1EC" });
    expect(b.elements[0]).toMatchObject({ fontFamily: "Inter Tight", fontWeight: "800", color: "#0E0E0C", textAlign: "left", lineHeight: 0.9 });
    expect((b.elements[0] as unknown as { fontSize: number }).fontSize).toBeCloseTo(1290 * 0.1325 * 0.3, 1);
    expect(b.elements[1]).toMatchObject({ fontFamily: "Inter Tight", fontWeight: "500", color: "#5E5D57", fontSize: 30 });
    expect(b.elements[2]).toMatchObject({ rotation: 0, frameStyle: "solid" });
    expect(applyStyle(sample(), "g1", "neon-athletic-night").groups[0]!.boards[0]!.elements[0]).toMatchObject({ textTransform: "uppercase" });
  });
  it("never touches content, marks, screenshots or translations", () => {
    const before = sample();
    const after = applyStyle(before, "g1", "candy-pop-social").groups[0]!.boards[0]!;
    const was = before.groups[0]!.boards[0]!;
    expect(after.elements[0]).toMatchObject({ content: "Track habits", marks: [{ start: 0, end: 5, fontWeight: 800 }] });
    expect((after.elements[2] as unknown as { screenshotSrc: string }).screenshotSrc).toBe((was.elements[2] as unknown as { screenshotSrc: string }).screenshotSrc);
    expect(after.localized).toEqual(was.localized);
  });
  it("leaves the document alone when there is nothing to apply to", () => {
    const d = sample();
    expect(applyStyle(d, "g1", "no-such-style")).toBe(d);
    expect(applyStyle(d, "missing-group", "swiss-grid-bold")).toBe(d);
  });
  it("a styled document is still a valid document", () => {
    for (const s of STYLES) expect(() => migrate(applyStyle(sample(), "g1", s.id)), s.id).not.toThrow();
  });
});
