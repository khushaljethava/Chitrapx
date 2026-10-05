import { catalogFont, matchWeight, parseWeight, type ArtboardState, type FontFormat, type TextElementProps } from "@chitrapx/document";
import type { CustomFontFace } from "./extras.ts";

export type FontFace = { weight: number; italic: boolean };
export type FontUse = { family: string; faces: FontFace[] };

/** Families and faces used by text on these boards (per-locale overrides already projected in). */
export function fontUsesOf(boards: ArtboardState[]): FontUse[] {
  const uses = new Map<string, Map<string, FontFace>>();
  const add = (family: string, weight: number, italic: boolean) => {
    const faces = uses.get(family) ?? new Map<string, FontFace>();
    faces.set(`${weight}:${italic}`, { weight, italic });
    uses.set(family, faces);
  };
  for (const b of boards) for (const el of b.elements) {
    if (el.type !== "text") continue;
    const t = el as TextElementProps;
    const family = t.fontFamily?.trim();
    if (!family) continue;
    const weight = parseWeight(t.fontWeight), italic = t.fontStyle === "italic";
    add(family, weight, italic);
    // Weight marks use the same family: request those faces too (the nearest one the family has).
    for (const m of t.marks ?? []) add(family, m.fontWeight ?? weight, m.italic ?? italic);
  }
  return [...uses].map(([family, faces]) => ({ family, faces: [...faces.values()] }));
}

export const fontFamiliesOf = (boards: ArtboardState[]): string[] => fontUsesOf(boards).map((u) => u.family);

/**
 * One css2 URL for the catalogue families in use: the weights the browser would pick (no
 * synthetic weights), the italic axis only where a family is used in italic and has one.
 * Anything not in the catalogue (system, generic, uploaded) is never sent to Google.
 */
export function googleFontsHref(uses: FontUse[]): string | null {
  const params = uses.flatMap((u) => {
    const font = catalogFont(u.family);
    if (!font) return [];
    const tuples = new Map<string, [number, number]>();
    for (const f of u.faces.length ? u.faces : [{ weight: 400, italic: false }]) {
      const ital = f.italic && font.italics ? 1 : 0;
      const w = matchWeight(font.weights, f.weight);
      tuples.set(`${ital},${w}`, [ital, w]);
    }
    const sorted = [...tuples.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const name = font.family.replace(/ /g, "+");
    return [sorted.some(([i]) => i)
      ? `family=${name}:ital,wght@${sorted.map(([i, w]) => `${i},${w}`).join(";")}`
      : `family=${name}:wght@${sorted.map(([, w]) => w).join(";")}`];
  }).sort();
  return params.length ? `https://fonts.googleapis.com/css2?${params.join("&")}&display=block` : null;
}

const FORMAT: Record<FontFormat, string> = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };
/** A CSS string literal that nothing can leave: quotes and backslashes escaped, "<" as \3c, line breaks dropped. */
const cssString = (s: string) => `"${s.replace(/[\\"]/g, "\\$&").replace(/</g, "\\3c ").replace(/[\n\r\f]/g, "")}"`;

/** One @font-face per uploaded face. display: block, like the Google stylesheet, so exports never capture fallback glyphs. */
export function customFontFaceCss(faces: CustomFontFace[]): string {
  return faces.map((f) => `@font-face{font-family:${cssString(f.family)};src:url(${cssString(f.url)}) format("${FORMAT[f.format]}");font-weight:${Math.round(f.weight)};font-style:${f.italic ? "italic" : "normal"};font-display:block}`).join("\n");
}

/** The Google stylesheet for catalogue families plus @font-face rules for the uploaded faces these boards use. */
export function BoardFonts({ boards, faces = [] }: { boards: ArtboardState[]; faces?: CustomFontFace[] }) {
  const uses = fontUsesOf(boards);
  const href = googleFontsHref(uses);
  const used = new Set(uses.map((u) => u.family));
  const css = customFontFaceCss(faces.filter((f) => used.has(f.family)));
  return (
    <>
      {href && <link rel="stylesheet" href={href} precedence="chitrapx-fonts" />}
      {css && <style data-chitrapx-custom-fonts="">{css}</style>}
    </>
  );
}
