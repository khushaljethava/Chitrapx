import type { ArtboardState } from "@chitrapx/document";
import { ALL_FONTS, SYSTEM_FONTS } from "./osg/lib/fontService";

const system = new Set(SYSTEM_FONTS.map((f) => f.family.toLowerCase()));
const generic = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
const known = new Map(ALL_FONTS.map((f) => [f.family.toLowerCase(), f]));

/** Font families used by text on these boards, including per-locale overrides already projected in. */
export function fontFamiliesOf(boards: ArtboardState[]): string[] {
  const out = new Set<string>();
  for (const b of boards) for (const el of b.elements) {
    const family = (el as { fontFamily?: string }).fontFamily?.trim();
    if (el.type === "text" && family) out.add(family);
  }
  return [...out];
}

/** One Google Fonts stylesheet URL for the families that need downloading; null when none do. */
export function googleFontsHref(families: string[]): string | null {
  const params = families
    .filter((f) => !system.has(f.toLowerCase()) && !generic.has(f.toLowerCase()))
    .sort()
    .map((family) => {
      const variants = known.get(family.toLowerCase())?.variants;
      const name = family.replace(/ /g, "+");
      return variants?.length ? `family=${name}:wght@${variants.join(";")}` : `family=${name}`;
    });
  return params.length ? `https://fonts.googleapis.com/css2?${params.join("&")}&display=block` : null;
}

/** React 19 hoists this stylesheet into <head>; display=block keeps exports from capturing fallback glyphs. */
export function BoardFonts({ boards }: { boards: ArtboardState[] }) {
  const href = googleFontsHref(fontFamiliesOf(boards));
  return href ? <link rel="stylesheet" href={href} precedence="chitrapx-fonts" /> : null;
}
