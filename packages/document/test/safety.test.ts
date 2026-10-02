import { describe, expect, it } from "vitest";
import { exportPlan, migrate, MAX_EXPORT_ITEMS, checkExportable } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const withBoard = (patch: Record<string, unknown>) => doc([group([{ ...board("b", [text("t", 0, 0)]), ...patch } as never])]);
const withElement = (patch: Record<string, unknown>) => doc([group([board("b", [{ ...text("t", 0, 0), ...patch } as never])])]);

describe("document safety", () => {
  it("rejects colour fields that are not colours (CSS injection into gradients)", () => {
    const evil = 'red, blue), url("http://10.0.0.5:8080/internal?';
    expect(() => migrate(withBoard({ backgroundType: "gradient", backgroundGradient: { color1: evil, color2: '"', angle: 0 } }))).toThrow();
    expect(() => migrate(withElement({ type: "shape", fillGradient: { color1: "#fff", color2: evil, angle: 0 } }))).toThrow();
    expect(() => migrate(withElement({ color: "url(http://x)" }))).toThrow();
  });

  it("accepts real colours", () => {
    for (const c of ["#fff", "#11223344", "rgba(0, 0, 0, 0.35)", "rgb(10 20 30 / 50%)", "hsl(200, 50%, 40%)", "transparent", "crimson"]) {
      expect(() => migrate(withElement({ color: c, shadow: { x: 0, y: 0, blur: 1, color: c } })), c).not.toThrow();
    }
  });

  it("rejects url(), CSS escapes and @import in any styling string, but not in text content", () => {
    expect(() => migrate(withElement({ type: "shape", clipPath: "url(http://169.254.169.254/)" }))).toThrow();
    expect(() => migrate(withElement({ type: "shape", clipPath: "u\\72l(http://x)" }))).toThrow();
    expect(() => migrate(withElement({ fontFamily: "x; @import 'http://x'" }))).toThrow();
    expect(() => migrate(withElement({ content: "Paste a url(like this) here" }))).not.toThrow();
  });

  it("rejects unsafe or duplicate locale codes and absurd board sizes", () => {
    const loc = (locales: Array<{ code: string }>, baseLocale = "en-US") => ({ ...doc([group([board("b", [])])]), localization: { baseLocale, locales } });
    expect(() => migrate(loc([{ code: "../../.bashrc.d" }]))).toThrow();
    expect(() => migrate(loc([], "en/US"))).toThrow();
    expect(() => migrate(loc([{ code: "de-DE" }, { code: "de-DE" }]))).toThrow();
    expect(() => migrate(loc([{ code: "en-US" }]))).toThrow();
    expect(() => migrate(loc([{ code: "zh-Hans" }, { code: "pt-BR" }, { code: "sq" }]))).not.toThrow();
    expect(() => migrate(doc([group([board("b", [], 30000, 30000)])]))).toThrow();
  });
});

describe("exportable", () => {
  it("uses the target's pixel size for every file", () => {
    expect(exportPlan(doc([group([board("b", [])])]))[0]).toMatchObject({ width: 1290, height: 2796 });
  });

  it("refuses boards that are not the target size, and plans above the limit", () => {
    expect(checkExportable(doc([group([board("b", [], 1000, 1000)])]))).toEqual({ ok: false, code: "board_size_mismatch" });
    const many = doc([group(Array.from({ length: MAX_EXPORT_ITEMS + 1 }, (_, i) => board(`b${i}`, [])))]);
    expect(checkExportable(many)).toEqual({ ok: false, code: "export_too_large" });
    expect(checkExportable(doc([group([board("b", [])])]))).toMatchObject({ ok: true });
  });
});
