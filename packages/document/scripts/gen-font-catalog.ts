// Writes src/fontCatalog.json: the curated families below, with weights, italics and scripts read from the
// Google Fonts metadata Next.js ships (next/dist/compiled/@next/font/dist/google/font-data.json). No API key.
// Run: pnpm --filter @chitrapx/document gen-font-catalog
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { CatalogFont, FontCategory, FontScript } from "../src/fontCatalog.ts";

export type GoogleMeta = Record<string, { weights: string[]; styles: string[]; subsets: string[] }>;

export const CURATED: Record<FontCategory, string[]> = {
  "sans-serif": ["Inter", "Inter Tight", "Roboto", "Roboto Flex", "Open Sans", "Lato", "Montserrat", "Poppins", "Raleway", "Nunito", "Nunito Sans", "Work Sans", "DM Sans", "Manrope", "Plus Jakarta Sans", "Sora", "Figtree", "Outfit", "Lexend", "Jost", "Urbanist", "Rubik", "Quicksand", "Cabin", "Karla", "Mulish", "Albert Sans", "Bricolage Grotesque", "Geist", "Onest", "Instrument Sans", "Be Vietnam Pro", "Space Grotesk", "IBM Plex Sans", "Source Sans 3", "Hind", "Barlow", "Barlow Condensed", "Barlow Semi Condensed", "Archivo", "Archivo Narrow", "Fira Sans", "Fira Sans Condensed", "Merriweather Sans", "PT Sans", "Ubuntu", "Oxygen", "Heebo", "Assistant", "Kanit", "Prompt", "Titillium Web", "Exo 2", "Red Hat Display", "Red Hat Text", "Public Sans", "Schibsted Grotesk", "Hanken Grotesk", "Familjen Grotesk", "Golos Text", "Wix Madefor Display", "Epilogue", "Syne", "Chivo", "Overpass", "Asap", "Signika", "Encode Sans", "Libre Franklin", "Mukta", "Varela Round", "M PLUS Rounded 1c", "Zen Kaku Gothic New", "Saira", "Saira Condensed", "Oswald", "Teko", "Big Shoulders", "Anek Latin", "Readex Pro", "Atkinson Hyperlegible"],
  serif: ["Playfair Display", "Lora", "Merriweather", "EB Garamond", "Cormorant Garamond", "Cormorant", "Libre Baskerville", "Source Serif 4", "Crimson Text", "Crimson Pro", "DM Serif Display", "DM Serif Text", "Fraunces", "Instrument Serif", "Newsreader", "Literata", "Spectral", "Bitter", "Zilla Slab", "Roboto Slab", "Arvo", "Noto Serif", "PT Serif", "Old Standard TT", "Cardo", "Bodoni Moda", "Libre Caslon Text", "Prata", "Gloock", "Young Serif", "Adamina", "Alegreya", "Domine", "Frank Ruhl Libre", "Lusitana", "Shippori Mincho", "Zen Old Mincho", "Noto Serif Display", "Rozha One", "Abril Fatface", "Alfa Slab One", "Yeseva One", "Marcellus", "Cinzel"],
  display: ["Bebas Neue", "Anton", "Archivo Black", "Bungee", "Ranchers", "Calistoga", "Baloo 2", "Fredoka", "Unbounded", "Righteous", "Titan One", "Luckiest Guy", "Bangers", "Monoton", "Lobster", "Fjalla One", "Russo One", "Lilita One", "Boogaloo", "Black Han Sans", "Bowlby One", "Rubik Mono One", "Dela Gothic One", "Chango", "Shrikhand", "Bagel Fat One", "Rammetto One", "Paytone One", "Passion One", "Staatliches", "Bungee Shade", "Rubik Glitch", "Climate Crisis", "Syne Mono", "Krona One", "Michroma", "Orbitron", "Audiowide", "Press Start 2P", "Silkscreen", "Cherry Bomb One", "Chewy", "Sniglet", "Gochi Hand"],
  handwriting: ["Pacifico", "Caveat", "Caveat Brush", "Dancing Script", "Great Vibes", "Permanent Marker", "Satisfy", "Sacramento", "Kaushan Script", "Parisienne", "Yellowtail", "Shadows Into Light", "Indie Flower", "Amatic SC", "Patrick Hand", "Homemade Apple", "Reenie Beanie", "Rock Salt", "Nothing You Could Do", "Mrs Saint Delafield", "Allura", "Cookie", "Courgette", "Kalam", "Architects Daughter", "Gloria Hallelujah", "Covered By Your Grace", "Just Another Hand", "Yuji Syuku"],
  monospace: ["JetBrains Mono", "Fira Code", "Source Code Pro", "Space Mono", "Geist Mono", "IBM Plex Mono", "Roboto Mono", "DM Mono", "Inconsolata", "Ubuntu Mono", "Courier Prime", "Martian Mono"],
};

/** Families whose picker group is not Latin. Keep in step with osg/lib/fontLanguageMatcher.ts. */
export const SCRIPT_FAMILIES: Array<[string, FontCategory, FontScript]> = [
  ["Noto Sans", "sans-serif", "multilingual"],
  ["Noto Sans Arabic", "sans-serif", "arabic"], ["IBM Plex Sans Arabic", "sans-serif", "arabic"], ["Cairo", "sans-serif", "arabic"],
  ["Tajawal", "sans-serif", "arabic"], ["Almarai", "sans-serif", "arabic"], ["Amiri", "serif", "arabic"],
  ["Scheherazade New", "serif", "arabic"], ["Markazi Text", "serif", "arabic"], ["Lateef", "serif", "arabic"],
  ["Noto Nastaliq Urdu", "serif", "urdu"],
  ["Noto Sans Hebrew", "sans-serif", "hebrew"], ["Noto Sans Thai", "sans-serif", "thai"],
  ["Noto Sans Devanagari", "sans-serif", "devanagari"], ["Noto Sans Bengali", "sans-serif", "bengali"],
  ["Noto Sans JP", "sans-serif", "cjk"], ["Noto Sans SC", "sans-serif", "cjk"], ["Noto Sans TC", "sans-serif", "cjk"],
  ["Noto Sans KR", "sans-serif", "cjk"], ["Noto Serif JP", "serif", "cjk"],
];

const SUBSET_SCRIPT: Record<string, FontScript> = { arabic: "arabic", hebrew: "hebrew", thai: "thai", devanagari: "devanagari", bengali: "bengali" };

export function buildCatalog(meta: GoogleMeta): CatalogFont[] {
  const entries: Array<[string, FontCategory, FontScript | null]> = [
    ...(Object.entries(CURATED) as Array<[FontCategory, string[]]>).flatMap(([category, families]) => families.map((f) => [f, category, null] as [string, FontCategory, null])),
    ...SCRIPT_FAMILIES,
  ];
  const seen = new Set<string>();
  return entries.map(([family, category, script]): CatalogFont => {
    if (seen.has(family)) throw new Error(`listed twice: ${family}`);
    seen.add(family);
    const m = meta[family];
    if (!m) throw new Error(`not a Google Fonts family (check the spelling): ${family}`);
    const weights = m.weights.filter((w) => /^\d+$/.test(w)).map(Number).sort((a, b) => a - b);
    const derived = [...new Set<FontScript>([...(m.subsets.includes("latin") ? ["latin" as const] : []), ...m.subsets.flatMap((s) => (SUBSET_SCRIPT[s] ? [SUBSET_SCRIPT[s]!] : []))])];
    const scripts: FontScript[] = script ? [script, ...derived.filter((s) => s !== script)] : derived.length ? derived : ["latin"];
    return { family, category, weights: weights.length ? weights : [400], italics: m.styles.includes("italic"), scripts };
  }).sort((a, b) => a.family.localeCompare(b.family));
}

if (import.meta.main) {
  const require = createRequire(join(import.meta.dirname, "../../../apps/web/package.json"));
  const meta = require("next/dist/compiled/@next/font/dist/google/font-data.json") as GoogleMeta;
  const catalog = buildCatalog(meta);
  writeFileSync(join(import.meta.dirname, "../src/fontCatalog.json"), `${JSON.stringify(catalog, null, 1)}\n`);
  console.log(`${catalog.length} families written`);
}
