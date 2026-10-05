import { describe, expect, it } from "vitest";
import { fontRows } from "@/editor/fontPickerModel.ts";

const all = { query: "", category: "all", used: [], custom: [] };

describe("font picker rows", () => {
  it("groups used, uploaded, Google and system fonts in that order", () => {
    const rows = fontRows({ ...all, used: ["Outfit", "My Brand"], custom: ["My Brand"] });
    expect(rows.slice(0, 3)).toEqual([
      { family: "Outfit", category: "sans-serif", group: "used" },
      { family: "My Brand", category: "custom", group: "used" },
      { family: "My Brand", category: "custom", group: "custom" },
    ]);
    expect(rows.filter((r) => r.group === "google").length).toBeGreaterThanOrEqual(150);
    expect(rows.at(-1)!.group).toBe("system");
  });
  it("searches every group, case-insensitively", () => {
    const rows = fontRows({ ...all, query: "pLAY", custom: ["Playful Co"] });
    expect(rows.map((r) => r.family)).toEqual(["Playful Co", "Playfair Display"]);
  });
  it("filters Google fonts by category", () => {
    const rows = fontRows({ ...all, category: "monospace" });
    expect(rows.every((r) => r.group !== "google" || r.category === "monospace")).toBe(true);
    expect(rows.some((r) => r.family === "JetBrains Mono")).toBe(true);
  });
});
