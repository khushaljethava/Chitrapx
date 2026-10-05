import { describe, expect, it } from "vitest";
import { briefSchema } from "@chitrapx/document";
import { briefPatch } from "@/components/briefForm.ts";

describe("brief form (review #2)", () => {
  it("turns the card's fields into the app's brief, accepted as-is by the app PATCH", () => {
    const patch = briefPatch({ text: " For baristas ", audience: "Home brewers", tone: "calm", keywords: "pour over, , grinder" }, "health");
    expect(patch).toEqual({ text: " For baristas ", audience: "Home brewers", tone: "calm", keywords: ["pour over", "grinder"], preset: "health" });
    expect(briefSchema.safeParse(patch).success).toBe(true);
  });
});
