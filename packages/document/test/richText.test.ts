import { describe, expect, it } from "vitest";
import { applyMark, clearMark, gradientCss, normalizeGradient, normalizeMarks, rangeStyle, remapMarks, segments, type Gradient, type TextMark } from "../src/index.ts";

const G: Gradient = { kind: "linear", angle: 90, stops: [{ color: "#ff0000", at: 0 }, { color: "#0000ff", at: 1 }] };

describe("normalizeMarks", () => {
  it("clamps, drops empty ranges, merges equal neighbours", () => {
    expect(normalizeMarks([{ start: -3, end: 4, fontWeight: 700 }, { start: 4, end: 8, fontWeight: 700 }, { start: 6, end: 6, italic: true }, { start: 18, end: 99, italic: true }], 20))
      .toEqual([{ start: 0, end: 8, fontWeight: 700 }, { start: 18, end: 20, italic: true }]);
  });
  it("splits overlaps, later marks winning per key", () => {
    expect(normalizeMarks([{ start: 0, end: 10, color: "#ff0000" }, { start: 5, end: 15, color: "#00ff00", italic: true }], 20))
      .toEqual([{ start: 0, end: 5, color: "#ff0000" }, { start: 5, end: 15, color: "#00ff00", italic: true }]);
  });
  it("drops marks with no style or unusable offsets, and garbage style values", () => {
    expect(normalizeMarks([{ start: 0, end: 5 }, { start: "a", end: 3, italic: true } as never, { start: 1, end: 2, fontWeight: "heavy" } as never], 10)).toEqual([]);
  });
  it("a later colour replaces an earlier gradient on the same letters", () => {
    expect(normalizeMarks([{ start: 0, end: 4, gradient: G }, { start: 2, end: 4, color: "#00ff00" }], 4))
      .toEqual([{ start: 0, end: 2, gradient: G }, { start: 2, end: 4, color: "#00ff00" }]);
  });
});

describe("applyMark / clearMark / rangeStyle", () => {
  it("styles a range, splitting the marks it crosses", () => {
    expect(applyMark([{ start: 0, end: 10, fontWeight: 700 }], { start: 3, end: 6 }, { italic: true }))
      .toEqual([{ start: 0, end: 3, fontWeight: 700 }, { start: 3, end: 6, fontWeight: 700, italic: true }, { start: 6, end: 10, fontWeight: 700 }]);
  });
  it("swaps a gradient for a colour, and null removes a key", () => {
    const withGradient = applyMark([], { start: 0, end: 4 }, { gradient: G });
    expect(withGradient).toEqual([{ start: 0, end: 4, gradient: G }]);
    expect(applyMark(withGradient, { start: 0, end: 4 }, { color: "#00ff00" })).toEqual([{ start: 0, end: 4, color: "#00ff00" }]);
    expect(applyMark([{ start: 0, end: 4, fontWeight: 700, italic: true }], { start: 0, end: 4 }, { italic: null })).toEqual([{ start: 0, end: 4, fontWeight: 700 }]);
  });
  it("an empty range changes nothing", () => {
    const marks: TextMark[] = [{ start: 0, end: 3, italic: true }];
    expect(applyMark(marks, { start: 2, end: 2 }, { fontWeight: 900 })).toEqual(marks);
  });
  it("clears chosen keys or all of them", () => {
    const marks: TextMark[] = [{ start: 0, end: 10, fontWeight: 700, italic: true }];
    expect(clearMark(marks, { start: 2, end: 4 }, ["italic"])).toEqual([{ start: 0, end: 2, fontWeight: 700, italic: true }, { start: 2, end: 4, fontWeight: 700 }, { start: 4, end: 10, fontWeight: 700, italic: true }]);
    expect(clearMark(marks, { start: 0, end: 10 })).toEqual([]);
  });
  it("reports the common style of a range, or mixed", () => {
    const marks: TextMark[] = [{ start: 0, end: 5, fontWeight: 700 }, { start: 5, end: 10, italic: true }];
    expect(rangeStyle(marks, { start: 3, end: 7 })).toEqual({ color: undefined, gradient: undefined, fontWeight: "mixed", italic: "mixed" });
    expect(rangeStyle(marks, { start: 0, end: 5 })).toEqual({ color: undefined, gradient: undefined, fontWeight: 700, italic: undefined });
    expect(rangeStyle(marks, { start: 6, end: 6 })).toMatchObject({ italic: true }); // caret: the letter after it
  });
});

describe("segments", () => {
  it("covers the whole content, unstyled gaps included", () => {
    expect(segments("Hello world", [{ start: 6, end: 11, fontWeight: 700 }])).toEqual([
      { start: 0, end: 6, text: "Hello ", style: {} },
      { start: 6, end: 11, text: "world", style: { fontWeight: 700 } },
    ]);
    expect(segments("", [{ start: 0, end: 3, italic: true }])).toEqual([]);
  });
});

describe("remapMarks", () => {
  it("never leaves a mark edge inside an emoji when the edit changes only its second half (M3)", () => {
    const splits = (s: string, i: number) => /[\uD800-\uDBFF]/.test(s[i - 1] ?? "") && /[\uDC00-\uDFFF]/.test(s[i] ?? "");
    for (const [from, to, marks] of [
      ["a😀b", "a😃b", [{ start: 0, end: 3, fontWeight: 800 }]],
      ["a😀b", "a😃b", [{ start: 3, end: 4, color: "#f00" }, { start: 0, end: 1, color: "#00f" }]],
      ["go 😀", "go 😃!", [{ start: 0, end: 5, italic: true }]],
    ] as Array<[string, string, TextMark[]]>) {
      const out = remapMarks(from, to, marks);
      expect(out.flatMap((m) => [m.start, m.end]).filter((i) => splits(to, i)), `${from} -> ${to}`).toEqual([]);
    }
    expect(remapMarks("a😀b", "a😃b", [{ start: 0, end: 3, fontWeight: 800 }])).toEqual([{ start: 0, end: 1, fontWeight: 800 }]);
  });

  const bold: TextMark[] = [{ start: 6, end: 12, fontWeight: 800 }]; // "habits" in "Track habits"
  it("insert before shifts the mark", () => expect(remapMarks("Track habits", "Track my habits", bold)).toEqual([{ start: 9, end: 15, fontWeight: 800 }]));
  it("insert after leaves it", () => expect(remapMarks("Track habits", "Track habits daily", bold)).toEqual(bold));
  it("insert inside grows it", () => expect(remapMarks("Track habits", "Track hab-its", bold)).toEqual([{ start: 6, end: 13, fontWeight: 800 }]));
  it("delete across clips it", () => expect(remapMarks("Track habits", "Trabits", bold)).toEqual([{ start: 3, end: 7, fontWeight: 800 }]));
  it("deleting the marked word drops it", () => expect(remapMarks("Track habits", "Track ", bold)).toEqual([]));
  it("pasting over the marked word drops it", () => expect(remapMarks("Track habits", "Track goal", bold)).toEqual([]));
  it("no change keeps the marks", () => expect(remapMarks("Track habits", "Track habits", bold)).toEqual(bold));
});

describe("gradients", () => {
  it("normalises stops: sorted, clamped, 2 to 8, linear angle defaulted", () => {
    expect(normalizeGradient({ kind: "linear", stops: [{ color: "#fff", at: 1.5 }, { color: "#000", at: -1 }] }))
      .toEqual({ kind: "linear", angle: 180, stops: [{ color: "#000", at: 0 }, { color: "#fff", at: 1 }] });
    expect(normalizeGradient({ kind: "linear", stops: [{ color: "#fff", at: 0 }] })).toBeUndefined();
    expect(normalizeGradient({ kind: "conic", stops: [] })).toBeUndefined();
    expect(normalizeGradient({ kind: "radial", stops: Array.from({ length: 12 }, (_, i) => ({ color: "#000", at: i / 11 })) })!.stops).toHaveLength(8);
  });
  it("becomes CSS", () => {
    expect(gradientCss(G)).toBe("linear-gradient(90deg, #ff0000 0%, #0000ff 100%)");
    expect(gradientCss({ kind: "radial", stops: G.stops })).toBe("radial-gradient(circle, #ff0000 0%, #0000ff 100%)");
  });
});
