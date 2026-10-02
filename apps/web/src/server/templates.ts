import { asc, eq } from "drizzle-orm";
import { db, schema } from "@chitrapx/db";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";

export type TemplateSummary = {
  slug: string; name: string; description: string; category: string; platforms: string[]; kind: string;
  /** The first board of the first group only: enough for a gallery card, a fraction of the payload. */
  preview: ChitrapxDoc;
};

export const TEMPLATE_CATEGORIES: Record<string, string> = {
  screenshots: "App screenshots",
  "play-feature-graphic": "Play feature graphic",
  mac: "Mac",
  "apple-watch": "Apple Watch",
  "app-preview": "App Preview video",
};

export async function listTemplates(): Promise<TemplateSummary[]> {
  const rows = await db.select().from(schema.templates).orderBy(asc(schema.templates.category), asc(schema.templates.name));
  return rows.map((r) => {
    const doc = migrate(r.doc);
    const g = doc.groups[0]!;
    return {
      slug: r.slug, name: r.name, description: r.description, category: r.category, platforms: r.platforms, kind: r.kind,
      preview: { ...doc, groups: [{ ...g, boards: g.boards.slice(0, 1), spanElements: [] }] },
    };
  });
}

export async function getTemplate(slug: string) {
  const [row] = await db.select().from(schema.templates).where(eq(schema.templates.slug, slug));
  return row ? { ...row, doc: migrate(row.doc) } : undefined;
}
