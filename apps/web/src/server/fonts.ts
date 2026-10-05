import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, lockWorkspace, schema, withTx, type Db, type FontMeta } from "@chitrapx/db";
import { docFontFamilies, type FontFormat } from "@chitrapx/document";
import type { Ctx } from "./context.ts";
import { HttpError, notFound } from "./http.ts";
import type { ObjectStorage } from "./storage.ts";

export const FONT_QUOTA = { faces: 20, bytes: 50 * 1024 * 1024 };
export type FontFaceRow = { assetId: string; weight: number; italic: boolean; format: FontFormat; url: string };
export type FontFamilyRow = { family: string; faces: FontFaceRow[] };
type FontAsset = typeof schema.assets.$inferSelect & { meta: FontMeta };

const fontsOf = (workspaceId: string) => and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.kind, "font"), isNull(schema.assets.appId));
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

export async function findWorkspaceFont(ctx: Ctx, sha256: string): Promise<FontAsset | undefined> {
  const [row] = await db.select().from(schema.assets).where(and(fontsOf(ctx.workspaceId), eq(schema.assets.sha256, sha256))).limit(1);
  return row as FontAsset | undefined;
}

export async function fontUsage(tx: Db, workspaceId: string): Promise<{ faces: number; bytes: number }> {
  const [row] = await tx.select({ faces: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${schema.assets.bytes}), 0)::bigint` })
    .from(schema.assets).where(fontsOf(workspaceId));
  return { faces: Number(row?.faces ?? 0), bytes: Number(row?.bytes ?? 0) };
}

/** 20 faces or 50 MB per workspace, whichever comes first. Checked at sign time and again under the workspace lock on insert. */
export async function assertFontQuota(tx: Db, ctx: Ctx, addingBytes: number): Promise<void> {
  const u = await fontUsage(tx, ctx.workspaceId);
  if (u.faces + 1 > FONT_QUOTA.faces || u.bytes + addingBytes > FONT_QUOTA.bytes) {
    throw new HttpError(403, "font_quota", `Your workspace has ${u.faces} of ${FONT_QUOTA.faces} fonts and ${mb(u.bytes)} of ${mb(FONT_QUOTA.bytes)}. Delete a font to upload another.`);
  }
}

/** True when the workspace already has this exact face (family, weight, style). */
export async function faceTaken(tx: Db, workspaceId: string, f: { family: string; weight: number; italic: boolean }): Promise<boolean> {
  const [row] = await tx.select({ id: schema.assets.id }).from(schema.assets).where(and(fontsOf(workspaceId),
    sql`${schema.assets.meta}->>'family' = ${f.family}`, sql`(${schema.assets.meta}->>'weight')::int = ${f.weight}`,
    sql`(${schema.assets.meta}->>'italic')::boolean = ${f.italic}`)).limit(1);
  return !!row;
}

export const faceExists = (f: { family: string; weight: number; italic: boolean }) =>
  new HttpError(409, "font_face_exists", `${f.family} already has a ${f.weight}${f.italic ? " italic" : ""} face. Delete it first to replace it.`);

/** True while any asset row in the workspace (a font or an app asset) still points at these bytes. */
export async function bytesInUse(tx: Db, workspaceId: string, sha256: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.assets.id }).from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.sha256, sha256))).limit(1);
  return !!row;
}

/** The workspace's font families, each with its faces (lightest first, upright before italic) and 1-hour URLs. */
export async function listFonts(ctx: Ctx, storage: ObjectStorage): Promise<FontFamilyRow[]> {
  const rows = (await db.select().from(schema.assets).where(fontsOf(ctx.workspaceId)).orderBy(asc(schema.assets.createdAt))) as FontAsset[];
  // Paths are rebuilt from workspace and hash, never read from the row.
  const urls = await storage.signedUrls(rows.map((r) => `${ctx.workspaceId}/${r.sha256}`));
  const families = new Map<string, FontFaceRow[]>();
  rows.forEach((r, i) => {
    const faces = families.get(r.meta.family) ?? [];
    faces.push({ assetId: r.id, weight: r.meta.weight, italic: r.meta.italic, format: r.meta.format, url: urls[i] ?? "" });
    families.set(r.meta.family, faces);
  });
  return [...families].map(([family, faces]) => ({ family, faces: faces.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic)) }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * Deletes one face. The last face of a family that any project in the workspace uses cannot go (409, with those projects).
 * Count and delete run under the workspace lock, so two deletes at once cannot both remove the last faces of a family.
 */
export async function deleteFont(ctx: Ctx, storage: ObjectStorage, assetId: string): Promise<void> {
  if (!z.uuid().safeParse(assetId).success) throw notFound();
  const sha = await withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const [row] = (await tx.select().from(schema.assets).where(and(fontsOf(ctx.workspaceId), eq(schema.assets.id, assetId)))) as FontAsset[];
    if (!row) throw notFound();
    const family = row.meta.family;
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.assets)
      .where(and(fontsOf(ctx.workspaceId), sql`${schema.assets.meta}->>'family' = ${family}`))) as [{ n: number }];
    if (Number(n) === 1) {
      const projects = await tx.select({ id: schema.projects.id, name: schema.projects.name, doc: schema.projects.doc })
        .from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId));
      const using = projects.filter((p) => docFontFamilies(p.doc).includes(family)).map(({ id, name }) => ({ id, name }));
      if (using.length) throw new HttpError(409, "font_in_use", `${family} is used in ${using.map((p) => p.name).join(", ")}`, { projects: using });
    }
    await tx.delete(schema.assets).where(eq(schema.assets.id, row.id));
    // Another row may share these bytes (same file uploaded as an image, or a leftover link): keep them then.
    return (await bytesInUse(tx, ctx.workspaceId, row.sha256)) ? null : row.sha256;
  });
  if (sha) await storage.remove(`${ctx.workspaceId}/${sha}`).catch(() => {});
}
