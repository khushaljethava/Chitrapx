/** Regenerates packages/assets/catalog.json from the bundled templates. Run after changing templates. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCatalog } from "../src/catalog.ts";

export const ASSETS = join(import.meta.dirname, "../../assets");

export function readTemplates() {
  const dir = join(ASSETS, "templates");
  return readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

export const renderCatalog = () => `${JSON.stringify(buildCatalog(readTemplates()), null, 1)}\n`;

if (import.meta.main) {
  writeFileSync(join(ASSETS, "catalog.json"), renderCatalog());
  console.log("catalog.json written");
}
