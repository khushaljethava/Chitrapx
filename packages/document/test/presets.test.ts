import { describe, expect, it } from "vitest";
import { applyPreset, BRAND_TOKENS, BRIEF_TONES, briefSchema, CATEGORY_BANKS, PRESET_KEYS, PRESETS, presetFor, type Preset } from "../src/index.ts";

describe("presets", () => {
  it("nine presets with a valid tone, a full palette, a real bank and chips that fit a pill", () => {
    expect(PRESETS.map((p) => p.key)).toEqual(["saas", "game", "finance", "health", "education", "travel", "social", "ecommerce", "utilities"]);
    expect(new Set(PRESET_KEYS).size).toBe(PRESETS.length);
    for (const p of PRESETS as readonly Preset[]) {
      expect(BRIEF_TONES, p.key).toContain(p.tone);
      expect(Object.keys(p.palette).sort(), p.key).toEqual([...BRAND_TOKENS].sort());
      for (const c of Object.values(p.palette)) expect(c, p.key).toMatch(/^#[0-9A-F]{6}$/);
      if (p.bankId) expect(CATEGORY_BANKS.some((b) => b.id === p.bankId), p.key).toBe(true);
      expect(p.chips.length, p.key).toBeGreaterThanOrEqual(4);
      for (const c of p.chips) {
        expect(c.length, c).toBeLessThanOrEqual(16);
        expect(c.split(" ").length, c).toBeLessThanOrEqual(2);
      }
      expect(briefSchema.safeParse({ text: p.aiBrief, audience: p.audience, tone: p.tone, preset: p.key }).success, p.key).toBe(true);
    }
  });

  it("fills only empty fields; a written brief is replaced only when confirmed", () => {
    const finance = presetFor("finance")!;
    expect(applyPreset({ text: "", audience: "", tone: "" }, "finance")).toEqual({ text: finance.aiBrief, audience: finance.audience, tone: "calm", preset: "finance" });
    expect(applyPreset({ text: "Mine", audience: "Teens", tone: "bold" }, "finance")).toEqual({ text: "Mine", audience: "Teens", tone: "bold", preset: "finance" });
    expect(applyPreset({ text: "Mine", audience: "", tone: "" }, "finance", true).text).toBe(finance.aiBrief);
  });

  it("the brief takes a preset key or none, nothing else", () => {
    expect(briefSchema.parse({ preset: "game" }).preset).toBe("game");
    expect(briefSchema.parse({ preset: "" }).preset).toBe("");
    expect(briefSchema.safeParse({ preset: "crypto-casino" }).success).toBe(false);
  });
});
