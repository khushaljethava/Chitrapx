import { describe, expect, it } from "vitest";
import { jobError } from "@/components/jobText.ts";

describe("job error text", () => {
  it("explains an import refused because an image is on the competitor board (SP11 final review)", () => {
    expect(jobError("asset_kind_conflict")).toBe("An image in this project file is on this app's competitor board. Remove it from the board, or import into another app.");
  });
});
