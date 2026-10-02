import { describe, expect, it } from "vitest";
import { contrastRatio, foldCount, lintBoard } from "../src/index.ts";
import { board, text } from "./fixtures.ts";

const t = (id: string, content: string, extra: Record<string, unknown> = {}) =>
  ({ ...text(id, 100, 100), content, fontSize: 30, size: { width: 1100, height: 300 }, color: "#111111", ...extra }) as never;
const codes = (b: ReturnType<typeof board>, locale?: { code: string; base: string }) => lintBoard(b, locale).map((i) => `${i.elementId}:${i.code}`);

describe("lintBoard", () => {
  it("a clean board has no issues", () => {
    expect(codes(board("b", [t("h", "Brew better coffee"), t("sub", "Recipes from real baristas", { fontSize: 14, position: { x: 100, y: 500 } })]))).toEqual([]);
  });

  it("flags too many words on a headline line and too many headline lines", () => {
    expect(codes(board("b", [t("h", "Track every single brew you make today")]))).toContain("h:headline_words");
    expect(codes(board("b", [t("h", "Brew\nbetter\ncoffee\ndaily")]))).toContain("h:headline_lines");
  });

  it("estimates wrapping: a long headline in a narrow box counts as several lines", () => {
    expect(codes(board("b", [t("h", "Brew better coffee daily", { size: { width: 300, height: 300 } })]))).toContain("h:headline_lines");
  });

  it("flags text too small to read in a store thumbnail", () => {
    expect(codes(board("b", [t("h", "Brew"), t("tiny", "Fine print", { fontSize: 6, position: { x: 100, y: 900 } })]))).toContain("tiny:too_small");
  });

  it("flags low contrast against the board background, gradients and shapes behind the text", () => {
    expect(codes({ ...board("b", [t("h", "Brew", { color: "#ffffff" })]), backgroundColor: "#ffffff" })).toContain("h:low_contrast");
    const grad = { ...board("b", [t("h", "Brew", { color: "#ffffff" })]), backgroundType: "gradient", backgroundGradient: { color1: "#000000", color2: "#f8f8f8", angle: 0 } };
    expect(codes(grad as never)).toContain("h:low_contrast");
    const shape = { id: "s", type: "shape", position: { x: 0, y: 0 }, size: { width: 1290, height: 800 }, rotation: 0, scale: 1, shapeType: "rectangle", fillColor: "#111111" };
    expect(codes(board("b", [shape as never, t("h", "Brew", { color: "#222222" })]))).toContain("h:low_contrast");
    expect(codes(board("b", [shape as never, t("h", "Brew", { color: "#ffffff" })]))).not.toContain("h:low_contrast");
  });

  it("ignores colours it cannot read instead of crashing", () => {
    expect(() => lintBoard(board("b", [t("h", "Brew", { color: "currentcolor" })]))).not.toThrow();
  });

  it("checks the active language: overrides replace text and long translations warn", () => {
    const b = { ...board("b", [t("h", "Brew coffee")]), localized: { "de-DE": { h: { content: "Brühe jeden Tag deinen besten Kaffee" } } } };
    expect(codes(b, { code: "de-DE", base: "en-US" })).toEqual(expect.arrayContaining(["h:headline_words", "h:translation_long"]));
    expect(codes(b, { code: "en-US", base: "en-US" })).toEqual([]);
  });
});

describe("contrastRatio and foldCount", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrastRatio("nope", "#fff")).toBeNull();
  });
  it("first 3 boards on Apple stores, first 2 on Google Play", () => {
    expect(foldCount("iphone-6.9")).toBe(3);
    expect(foldCount("android-phone")).toBe(2);
    expect(foldCount("play-feature")).toBe(1);
  });
});
