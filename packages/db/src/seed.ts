/** Upserts the bundled templates (packages/assets/templates) into the templates table. Idempotent. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate as migrateDoc } from "@chitrapx/document";
import { db, pool, schema } from "./client.ts";

type TemplateFile = {
  slug: string; name: string; description: string; category: string; platforms: string[];
  kind: "screenshots" | "video" | "social"; source: "osg" | "ass" | "pixeldeck" | "chitrapx"; licenseNote: string; doc: unknown;
};

export async function seedTemplates(): Promise<number> {
  const dir = join(import.meta.dirname, "../../assets/templates");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const rows = files.map((f) => {
    const t = JSON.parse(readFileSync(join(dir, f), "utf8")) as TemplateFile;
    return { slug: t.slug, name: t.name, description: t.description, category: t.category, platforms: t.platforms,
      kind: t.kind, source: t.source, licenseNote: t.licenseNote, doc: migrateDoc(t.doc) };
  });
  await db.insert(schema.templates).values(rows).onConflictDoUpdate({
    target: schema.templates.slug,
    set: {
      name: sql`excluded.name`, description: sql`excluded.description`, category: sql`excluded.category`,
      platforms: sql`excluded.platforms`, kind: sql`excluded.kind`, doc: sql`excluded.doc`,
      source: sql`excluded.source`, licenseNote: sql`excluded.license_note`,
    },
  });
  return rows.length;
}

if (import.meta.main) {
  console.log(`seeded ${await seedTemplates()} templates`);
  await pool.end();
}
