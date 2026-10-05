import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFont, cleanFamilyName, FONT_CATALOG, isReservedFamily, matchWeight, parseWeight } from "../src/index.ts";
import { buildCatalog } from "../scripts/gen-font-catalog.ts";

/** GOOGLE_FONTS before SP10: every one must survive into the catalogue. */
const BEFORE = ["Bricolage Grotesque", "Oswald", "Bungee", "Almarai", "Ranchers", "Roboto Flex", "DM Serif Display", "Adamina", "Merriweather Sans", "Calistoga", "Pacifico", "Baloo 2", "Caveat", "Fira Sans Condensed", "Noto Sans", "Anton", "Bebas Neue", "Abril Fatface", "Alfa Slab One", "Lobster", "Righteous", "Titan One", "Luckiest Guy", "Bangers", "Monoton", "Fredoka", "Unbounded", "Dancing Script", "Great Vibes", "Permanent Marker", "Satisfy", "Playfair Display", "Poppins", "Space Grotesk", "Outfit", "Noto Sans Arabic", "Cairo", "Tajawal", "Amiri", "Scheherazade New", "Markazi Text", "IBM Plex Sans Arabic", "Lateef", "Noto Nastaliq Urdu", "Noto Sans Hebrew", "Noto Sans Thai", "Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", "Noto Sans KR", "Noto Serif JP"];

describe("font catalogue", () => {
  it("has 150 to 300 unique families, each with weights, a category and a primary script", () => {
    expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(150);
    expect(FONT_CATALOG.length).toBeLessThanOrEqual(300);
    expect(new Set(FONT_CATALOG.map((f) => f.family)).size).toBe(FONT_CATALOG.length);
    for (const f of FONT_CATALOG) {
      expect(f.weights.length, f.family).toBeGreaterThan(0);
      expect(["sans-serif", "serif", "display", "handwriting", "monospace"]).toContain(f.category);
      expect(f.scripts.length, f.family).toBeGreaterThan(0);
    }
  });
  it("keeps every family the app offered before, with its script", () => {
    for (const family of BEFORE) expect(catalogFont(family), family).toBeDefined();
    expect(catalogFont("Noto Sans JP")!.scripts[0]).toBe("cjk");
    expect(catalogFont("Noto Nastaliq Urdu")!.scripts[0]).toBe("urdu");
    expect(catalogFont("Cairo")!.scripts[0]).toBe("arabic");
    expect(catalogFont("Noto Sans")!.scripts[0]).toBe("multilingual");
    expect(catalogFont("Playfair Display")!.italics).toBe(true);
    expect(catalogFont("Bebas Neue")).toMatchObject({ weights: [400], italics: false });
  });
  it("covers every family the bundled templates use", () => {
    const dir = join(import.meta.dirname, "../../assets/templates");
    for (const file of readdirSync(dir)) {
      JSON.stringify(JSON.parse(readFileSync(join(dir, file), "utf8")), (k, v) => {
        if (k === "fontFamily" && typeof v === "string") expect(isReservedFamily(v), `${file}: ${v}`).toBe(true);
        return v;
      });
    }
  });
  it("matches weights the way CSS does", () => {
    expect(matchWeight([400, 700], 600)).toBe(700);
    expect(matchWeight([400, 700], 500)).toBe(400);
    expect(matchWeight([300, 700], 450)).toBe(300);
    expect(matchWeight([400, 700], 300)).toBe(400);
    expect(matchWeight([100, 200], 900)).toBe(200);
    expect(matchWeight([400], 400)).toBe(400);
  });
  it("parses stored weights", () => {
    expect([parseWeight("normal"), parseWeight("bold"), parseWeight("600"), parseWeight(undefined), parseWeight("bogus"), parseWeight(800)]).toEqual([400, 700, 600, 400, 400, 800]);
  });
  it("reserves catalogue, system and generic names, case-insensitively", () => {
    expect(isReservedFamily("inter")).toBe(true);
    expect(isReservedFamily("Arial")).toBe(true);
    expect(isReservedFamily("sans-serif")).toBe(true);
    expect(isReservedFamily("Acme Brand Sans")).toBe(false);
  });
  it("cleans font names read from untrusted files", () => {
    expect(cleanFamilyName('Evil"; } body{background:url(//e)}')).toBe("Evil body backgroundurle");
    expect(cleanFamilyName("  My\u0000 Font\n Pro ")).toBe("My Font Pro");
    expect(cleanFamilyName("Ünïcode Sans 2")).toBe("Ünïcode Sans 2");
    expect(cleanFamilyName("{}<>;")).toBe("");
    expect(cleanFamilyName("x".repeat(200))).toHaveLength(80);
    expect(cleanFamilyName(`"Inter"`)).toBe("Inter");
    expect(cleanFamilyName(" 'Open Sans' ")).toBe("Open Sans");
    expect(cleanFamilyName("Rock 'n' Roll")).toBe("Rock 'n' Roll");
  });
  it("the generator refuses a misspelt family", () => {
    expect(() => buildCatalog({})).toThrow(/not a Google Fonts family/);
  });
});
