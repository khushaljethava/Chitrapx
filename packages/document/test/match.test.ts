import { describe, expect, it } from "vitest";
import { matchElements } from "../src/index.ts";
import { board, device, text } from "./fixtures.ts";

describe("matchElements", () => {
  it("pairs the nth element of each type", () => {
    const a = board("a", [text("t1", 0, 0), device("d1", 0), text("t2", 0, 0)]);
    const b = board("b", [device("x1", 0), text("y1", 0, 0), text("y2", 0, 0)]);
    expect([...matchElements(a, b)]).toEqual([["t1", "y1"], ["d1", "x1"], ["t2", "y2"]]);
  });
  it("skips elements with no counterpart", () => {
    expect([...matchElements(board("a", [device("d1", 0), device("d2", 0)]), board("b", [device("x1", 0)]))]).toEqual([["d1", "x1"]]);
  });
});
