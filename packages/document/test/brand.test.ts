import { describe, expect, it } from "vitest";
import { brandPalette, docBrandTokens, isBrandToken, parseBrandToken, resolveBrand, toBrandToken } from "../src/index.ts";

const palette = { primary: "#4f46e5", accent: "#f59e0b" };

describe("brand tokens", () => {
  it("parses only the six tokens", () => {
    expect(isBrandToken("brand:primary")).toBe(true);
    expect(isBrandToken("brand:pink")).toBe(false);
    expect(parseBrandToken("brand:muted")).toBe("muted");
    expect(toBrandToken("surface")).toBe("brand:surface");
  });
  it("seeds primary and secondary from the old fields when no palette is saved", () => {
    expect(brandPalette({ primaryColor: "#111111", secondaryColor: "#222222" })).toEqual({ primary: "#111111", secondary: "#222222" });
    expect(brandPalette({ primaryColor: "#111111", palette: [{ token: "accent", color: "#333333" }] })).toEqual({ accent: "#333333" });
    expect(brandPalette(undefined)).toEqual({});
  });
  it("resolves tokens in colours, gradient stops and marks", () => {
    const el = { color: "brand:primary", gradient: { kind: "linear", stops: [{ color: "brand:accent", at: 0 }, { color: "#fff", at: 1 }] }, marks: [{ start: 0, end: 2, color: "brand:accent" }] };
    expect(resolveBrand(el, palette)).toEqual({ color: "#4f46e5", gradient: { kind: "linear", stops: [{ color: "#f59e0b", at: 0 }, { color: "#fff", at: 1 }] }, marks: [{ start: 0, end: 2, color: "#f59e0b" }] });
  });
  it("drops what it cannot resolve, so the element default applies; a gradient goes whole", () => {
    const el = { color: "brand:text", fillColor: "brand:primary", gradient: { kind: "linear", stops: [{ color: "brand:muted", at: 0 }, { color: "#fff", at: 1 }] }, marks: [{ start: 0, end: 2, color: "brand:surface", fontWeight: 700 }] };
    const out = resolveBrand(el, palette);
    expect(out).toEqual({ fillColor: "#4f46e5", marks: [{ start: 0, end: 2, fontWeight: 700 }] });
    expect(JSON.stringify(resolveBrand(el, undefined))).not.toContain("brand:");
    expect(resolveBrand({ backgroundType: "gradient", backgroundGradient: { color1: "brand:accent", color2: "brand:secondary", angle: 90 } }, palette)).toEqual({ backgroundType: "gradient" });
  });
  it("returns the same value when there is no token", () => {
    const plain = { color: "#000", marks: [] };
    expect(resolveBrand(plain, palette)).toBe(plain);
  });
  it("lists the tokens a document uses", () => {
    expect(docBrandTokens({ a: "brand:primary", b: [{ c: "brand:muted" }, "brand:primary"], d: "#fff" }).sort()).toEqual(["muted", "primary"]);
  });
});
