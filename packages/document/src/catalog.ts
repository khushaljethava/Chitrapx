import type { ChitrapxDoc } from "./doc.ts";
import { getTarget } from "./targets.ts";

export type CatalogEntry = {
  slug: string;
  name: string;
  description: string;
  category: string;
  target: string;
  /** Per board: how many screenshots it shows and how many text slots it has. */
  boards: Array<{ devices: number; texts: number }>;
};

type TemplateFile = { slug: string; name: string; description: string; category: string; kind: string; doc: ChitrapxDoc };

/** The compact list the AI chooses a template from. Video templates are excluded until motion ships. */
export function buildCatalog(templates: TemplateFile[]): CatalogEntry[] {
  return templates
    .filter((t) => t.kind === "screenshots")
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((t) => {
      const g = t.doc.groups[0]!;
      return {
        slug: t.slug, name: t.name, description: t.description, category: t.category,
        target: getTarget(g.target)?.label ?? g.target,
        boards: g.boards.map((b) => ({
          devices: b.elements.filter((e) => e.type === "device").length,
          texts: b.elements.filter((e) => e.type === "text").length,
        })),
      };
    });
}
