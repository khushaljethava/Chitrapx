import { describe, expect, it } from "vitest";
import { CATEGORY_BANKS, defaultRole, FORMULA_ROLES, FORMULAS, hasPlaceholder } from "../src/index.ts";

describe("headline formulas", () => {
  it("cover all five roles, each formula with a worked example", () => {
    expect(FORMULA_ROLES.map((r) => r.id)).toEqual(["hero", "differentiator", "feature", "proof", "closer"]);
    for (const r of FORMULA_ROLES) expect(FORMULAS.filter((f) => f.role === r.id).length, r.id).toBeGreaterThanOrEqual(4);
    for (const f of FORMULAS) expect(f.example.trim(), f.id).not.toBe("");
  });
  it("have about a dozen category banks of short lines", () => {
    expect(CATEGORY_BANKS.length).toBeGreaterThanOrEqual(12);
    for (const c of CATEGORY_BANKS) {
      expect(c.lines.length, c.id).toBeGreaterThanOrEqual(4);
      for (const l of c.lines) for (const line of l.text.split("\n")) expect(line.length, l.id).toBeLessThanOrEqual(30);
    }
  });
  it("are keyed by unique ids for later localisation", () => {
    const ids = [...FORMULAS.map((f) => f.id), ...CATEGORY_BANKS.flatMap((c) => [c.id, ...c.lines.map((l) => l.id)])];
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("pick a role from the board's position", () => {
    expect([defaultRole(0, 5), defaultRole(2, 5), defaultRole(4, 5), defaultRole(0, 1)]).toEqual(["hero", "feature", "closer", "hero"]);
  });
  it("spot unfilled placeholders", () => {
    expect(hasPlaceholder("[verb] it once.\nTracked forever.")).toBe(true);
    expect(hasPlaceholder("Track habits.")).toBe(false);
    expect(hasPlaceholder("Prices [] here")).toBe(false);
  });
});
