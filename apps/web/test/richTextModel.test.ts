import { describe, expect, it } from "vitest";
import type { TextElementProps } from "@chitrapx/document";
import { marksFor, stylingNotCarried } from "@/editor/richTextModel.ts";

const base = { content: "Track habits", marks: [{ start: 6, end: 12, fontWeight: 800 }] } as TextElementProps;

describe("rich text in languages", () => {
  it("edits the base marks in the base language", () => expect(marksFor(base, undefined, false)).toEqual(base.marks));
  it("a language without its own wording shows the base marks", () => expect(marksFor(base, { fontFamily: "Noto Sans" }, true)).toEqual(base.marks));
  it("a language with its own wording uses its own marks, or none", () => {
    expect(marksFor(base, { content: "Gewohnheiten" }, true)).toEqual([]);
    expect(marksFor(base, { content: "Gewohnheiten", marks: [{ start: 0, end: 4, italic: true }] }, true)).toEqual([{ start: 0, end: 4, italic: true }]);
  });
  it("says so when styling did not carry over", () => {
    expect(stylingNotCarried(base, { content: "Gewohnheiten" })).toBe(true);
    expect(stylingNotCarried(base, { content: "Track habits" })).toBe(false);
    expect(stylingNotCarried(base, { content: "Gewohnheiten", marks: [{ start: 0, end: 4, italic: true }] })).toBe(false);
    expect(stylingNotCarried({ content: "Plain" } as TextElementProps, { content: "Einfach" })).toBe(false);
  });
});
