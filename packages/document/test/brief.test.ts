import { describe, expect, it } from "vitest";
import { briefSchema, briefText, glossarySchema } from "../src/index.ts";

describe("app brief", () => {
  it("serialises free text and the structured fields, leaving empty ones out", () => {
    expect(briefText({ text: "  For home baristas  ", audience: "Coffee nerds", tone: "calm", keywords: ["pour over", "grinder"] }))
      .toBe("For home baristas\nAudience: Coffee nerds\nTone: calm\nKeywords: pour over, grinder");
    expect(briefText({ audience: " ", tone: "", keywords: [] })).toBe("");
    expect(briefText(undefined)).toBe("");
  });

  it("rejects a brief over 2000 characters with a message, never cutting it", () => {
    const r = briefSchema.safeParse({ text: "x".repeat(2001) });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe("Keep the brief under 2000 characters");
    expect(briefSchema.parse({ text: ` ${"x".repeat(2000)} ` }).text).toHaveLength(2000);
  });

  it("keeps the first spelling of repeated keywords, at most 10, and refuses unknown fields and tones", () => {
    expect(briefSchema.parse({ keywords: ["Meal plan", "meal plan", " groceries "] }).keywords).toEqual(["Meal plan", "groceries"]);
    expect(briefSchema.safeParse({ keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }).success).toBe(false);
    expect(briefSchema.safeParse({ tone: "shouty" }).success).toBe(false);
    expect(briefSchema.safeParse({ colour: "red" }).success).toBe(false);
    expect(briefSchema.parse({ tone: "" }).tone).toBe("");
  });

  it("glossary terms are trimmed and deduplicated, at most 50 of 60 characters", () => {
    expect(glossarySchema.parse([" Bloom ", "bloom", "Pour-over Pro"])).toEqual(["Bloom", "Pour-over Pro"]);
    expect(glossarySchema.safeParse(Array.from({ length: 51 }, (_, i) => `t${i}`)).success).toBe(false);
    expect(glossarySchema.safeParse(["x".repeat(61)]).success).toBe(false);
    expect(glossarySchema.safeParse([" "]).success).toBe(false);
  });
});
