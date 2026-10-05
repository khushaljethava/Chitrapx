import { describe, expect, it } from "vitest";
import { appBrief, copyPrompt, pickPrompt, variantsPrompt, type AppBrief } from "../src/ai/prompts.ts";

const app: AppBrief = { name: "Bloom", description: "Coffee recipes", platform: "ios", brief: "Busy parents\nKeywords: pour over, grinder", brand: {} };

describe("prompt builders (SP11)", () => {
  it("copy variants read the app's brief", () => {
    expect(variantsPrompt({ name: "Bloom", brief: "Audience: home baristas" }, [{ id: "h", text: "Brew" }])).toContain("Brief: Audience: home baristas");
    expect(variantsPrompt({ name: "Bloom", brief: "" }, [])).toContain("Brief: (none)");
  });

  it("keywords reach the pick and copy prompts as a list", () => {
    expect(pickPrompt(app, [])).toContain("Keywords: pour over, grinder");
    expect(copyPrompt(app, [], [], [], [])).toContain("Keywords: pour over, grinder");
  });

  it("appBrief serialises the stored brief unless a submitted one is given", () => {
    const row = { name: "Bloom", description: "d", platformHint: "both", brand: {}, brief: { text: "Saved", tone: "calm" as const } };
    expect(appBrief(row).brief).toBe("Saved\nTone: calm");
    expect(appBrief(row, { brief: "Submitted" }).brief).toBe("Submitted");
  });
});
