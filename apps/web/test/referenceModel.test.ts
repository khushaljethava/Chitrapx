import { describe, expect, it } from "vitest";
import { analyseCost, analyseLabel, insightOf, slotsLeft } from "@/components/referenceModel.ts";

const done = { headline: "H", benefit: "B", layout: "L", colourMood: "M", differentiate: "D" };
const rows = (analysed: number, fresh: number) => [
  ...Array.from({ length: analysed }, (_, i) => ({ id: `a${i}`, url: "", insight: done })),
  ...Array.from({ length: fresh }, (_, i) => ({ id: `f${i}`, url: "", insight: null })),
];

describe("reference board model", () => {
  it("costs one credit per image not yet analysed and says so", () => {
    expect(analyseCost(rows(1, 2))).toBe(2);
    expect(analyseLabel(rows(1, 2))).toBe("Analyse (2 credits)");
    expect(analyseLabel(rows(0, 1))).toBe("Analyse (1 credit)");
    expect(analyseLabel(rows(3, 0))).toBe("Refresh summary (free)");
  });

  it("counts the slots left and reads only well-formed analyses", () => {
    expect(slotsLeft(rows(4, 4))).toBe(2);
    expect(slotsLeft(rows(10, 1))).toBe(0);
    expect(insightOf(done)).toEqual(done);
    expect(insightOf({ headline: "H" })).toBeNull();
  });
});
