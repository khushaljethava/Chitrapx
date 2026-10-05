import { catalogFont, FONT_CATALOG, SYSTEM_FAMILIES } from "@chitrapx/document";

export type FontRow = { family: string; category: string; group: "used" | "custom" | "google" | "system" };
export const GROUP_LABELS: Record<FontRow["group"], string> = { used: "Used in this project", custom: "Your fonts", google: "Google Fonts", system: "System" };

/** The picker's rows: used fonts first, then uploads, the catalogue (category-filtered) and system fonts. */
export function fontRows({ query, category, used, custom }: { query: string; category: string; used: string[]; custom: string[] }): FontRow[] {
  const q = query.trim().toLowerCase();
  // Matches at a word start, so "play" finds Playfair but not every "Display".
  const hit = (family: string) => !q || ` ${family.toLowerCase()}`.includes(` ${q}`);
  const categoryOf = (family: string) => catalogFont(family)?.category ?? SYSTEM_FAMILIES.find((s) => s.family === family)?.category ?? "custom";
  return [
    ...used.filter(hit).map((family) => ({ family, category: categoryOf(family), group: "used" as const })),
    ...custom.filter(hit).map((family) => ({ family, category: "custom", group: "custom" as const })),
    ...FONT_CATALOG.filter((f) => hit(f.family) && (category === "all" || f.category === category)).map((f) => ({ family: f.family, category: f.category, group: "google" as const })),
    ...SYSTEM_FAMILIES.filter((f) => hit(f.family)).map((f) => ({ family: f.family, category: f.category, group: "system" as const })),
  ];
}
