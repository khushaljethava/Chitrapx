import { catalogFont, matchWeight, parseWeight, type ArtboardState, type TextElementProps } from "@chitrapx/document";

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
    add(family, parseWeight(t.fontWeight), t.fontStyle === "italic");
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

/** React 19 hoists this stylesheet into <head>; display=block keeps exports from capturing fallback glyphs. */
export function BoardFonts({ boards }: { boards: ArtboardState[] }) {
  const href = googleFontsHref(fontUsesOf(boards));
  return href ? <link rel="stylesheet" href={href} precedence="chitrapx-fonts" /> : null;
}
