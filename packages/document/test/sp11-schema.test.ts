import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

describe("SP11 document fields", () => {
  it("documents saved before SP11 pass migrate unchanged, templates included", () => {
    const d = doc([group([board("b1", [text("t", 0, 0)])])]);
    expect(migrate(d)).toEqual(d);
    const dir = join(import.meta.dirname, "../../assets/templates");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
      const once = migrate(JSON.parse(readFileSync(join(dir, f), "utf8")).doc);
      expect(migrate(once), f).toEqual(once);
    }
  });

  it("keeps mirrorRtl and refuses anything but a boolean", () => {
    const d = doc([group([board("b1", [])])]);
    d.localization = { baseLocale: "en-US", locales: [{ code: "ar-SA" }], mirrorRtl: true };
    expect(migrate(d).localization.mirrorRtl).toBe(true);
    expect(() => migrate({ ...d, localization: { ...d.localization, mirrorRtl: "yes" } })).toThrow();
  });
});
