import { describe, expect, it } from "vitest";
import { chipEditError } from "@/editor/chipsModel.ts";

describe("chip edits (SP11 final review)", () => {
  const chips = ["Fast", "Private", "Offline"];

  it("refuses a chip another chip already has, case and spaces aside, with a message", () => {
    expect(chipEditError(chips, 2, "  fast ")).toBe("Each chip must be different");
    expect(chipEditError(chips, 0, "PRIVATE")).toBe("Each chip must be different");
  });

  it("accepts a new word, the chip's own word in other case, and a blank (which deletes the chip)", () => {
    expect(chipEditError(chips, 0, "Quick")).toBeNull();
    expect(chipEditError(chips, 0, "FAST")).toBeNull();
    expect(chipEditError(chips, 0, "  ")).toBeNull();
  });
});
