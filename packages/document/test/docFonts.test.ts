import { describe, expect, it } from "vitest";
import { docFontFamilies } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

describe("docFontFamilies", () => {
  it("finds families on boards, span elements and locale overrides, once each", () => {
    const b = board("b1", [text("t", 0, 0), { ...text("u", 0, 300), fontFamily: " Outfit " } as never]);
    b.localized = { "de-DE": { t: { fontFamily: "Pacifico (custom)" } } };
    const d = doc([group([b], [{ ...text("s", 0, 0), fontFamily: "Anton" } as never])]);
    expect(docFontFamilies(d).sort()).toEqual(["Anton", "Inter", "Outfit", "Pacifico (custom)"]);
  });
});
