import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ASSETS, renderCatalog } from "../scripts/gen-catalog.ts";

it("catalog.json is up to date with the templates (run pnpm --filter @chitrapx/document gen-catalog)", () => {
  expect(readFileSync(join(ASSETS, "catalog.json"), "utf8")).toBe(renderCatalog());
  const catalog = JSON.parse(renderCatalog());
  expect(catalog.length).toBeGreaterThan(80);
  expect(catalog.every((c: { boards: unknown[] }) => c.boards.length > 0)).toBe(true);
});

it("feature graphics with chips say so, and only those", () => {
  const catalog = JSON.parse(renderCatalog()) as Array<{ slug: string; boards: Array<{ chips?: number }> }>;
  const withChips = catalog.filter((c) => c.boards.some((b) => b.chips)).map((c) => c.slug);
  expect(withChips).toEqual(["fg-food-delivery", "fg-habit-tracker", "fg-music-stream", "fg-travel-explore"]);
});
