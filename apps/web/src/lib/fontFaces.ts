import type { CustomFontFace } from "@chitrapx/renderer";
import type { FontFamilyRow } from "@/server/fonts.ts";

/** The renderer's face list from the font API rows, optionally only the families a document uses. */
export function facesOf(fonts: FontFamilyRow[], families?: ReadonlySet<string>): CustomFontFace[] {
  return fonts.filter((f) => !families || families.has(f.family))
    .flatMap((f) => f.faces.map(({ weight, italic, format, url }) => ({ family: f.family, weight, italic, format, url })));
}
