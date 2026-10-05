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
  it("a preset adds its vertical to the pick and copy prompts; two presets read differently; none changes nothing", () => {
    const plain = pickPrompt(app, []);
    const finance = pickPrompt({ ...app, preset: "finance" }, []);
    const game = pickPrompt({ ...app, preset: "game" }, []);
    expect(plain).not.toContain("Vertical:");
    expect(finance).toContain("Vertical: Finance / Fintech.");
    expect(finance).toContain('"Your money, finally clear."');
    expect(finance).not.toBe(game);
    expect(copyPrompt({ ...app, preset: "game" }, [], [], [], [])).toContain("Vertical: Game / Entertainment.");
    expect(copyPrompt(app, [], [], [], [])).not.toContain("Vertical:");
  });

  it("suggests the preset's colours only when the app has no brand colours", () => {
    expect(pickPrompt({ ...app, preset: "finance" }, [])).toContain("Suggested colours for this vertical: #0F766E");
    expect(pickPrompt({ ...app, preset: "finance", brand: { primaryColor: "#112233" } }, [])).not.toContain("Suggested colours");
  });

  it("an app with only an SP10 brand palette counts as having brand colours (F12)", () => {
    expect(pickPrompt({ ...app, preset: "finance", brand: { palette: [{ token: "primary", color: "#112233" }] } }, [])).not.toContain("Suggested colours");
  });
});
