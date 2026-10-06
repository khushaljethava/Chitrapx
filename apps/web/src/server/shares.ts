import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db, lockWorkspace, PLANS, schema, withTx, type FontMeta } from "@chitrapx/db";
import { assetIdFromSrc, brandPalette, docFontFamilies, migrate, type ChitrapxDoc } from "@chitrapx/document";
import type { RenderExtras } from "@chitrapx/renderer";
import { getApp } from "./apps.ts";
import { authorize } from "./authz.ts";
import { mapSources } from "./community.ts";
import type { Ctx } from "./context.ts";
import { rateLimiter } from "@/lib/rateLimit.ts";
import { HttpError, notFound } from "./http.ts";
import { docAssetIds } from "./projects.ts";
import type { ObjectStorage } from "./storage.ts";

/**
 * SP15 share by link: a public, read-only view of a project's current document. Slugs resolve only
 * here, through the server's connection. Asset links in the view are our own HMAC-signed, one-hour
 * URLs that re-check the slug, because storage URLs embed the workspace id in their path.
 */
const s = schema.projectShares;
const SLUG = /^[A-Za-z0-9_-]{24}$/;
const ASSET_TTL_MS = 60 * 60_000;
const PARTS = ["file", "webm", "poster"] as const;
type Part = (typeof PARTS)[number];

/** Per-IP limits for the public page and API, and for the asset stream (a page loads many assets). */
export const viewLimit = rateLimiter({ limit: 60, windowMs: 60_000 });
export const assetLimit = rateLimiter({ limit: 600, windowMs: 60_000 });
/** Per user: copying assets is the expensive part. */
export const duplicateLimit = rateLimiter({ limit: 10, windowMs: 60_000 });

export type ShareInfo = { slug: string; path: string; allowDuplicate: boolean; expiresAt: Date | null; createdAt: Date };
const info = (r: typeof s.$inferSelect): ShareInfo => ({ slug: r.slug, path: `/s/${r.slug}`, allowDuplicate: r.allowDuplicate, expiresAt: r.expiresAt, createdAt: r.createdAt });
const live = () => and(isNull(s.revokedAt), or(isNull(s.expiresAt), gt(s.expiresAt, new Date())));

async function ownProject(ctx: Ctx, projectId: string): Promise<void> {
  if (!z.uuid().safeParse(projectId).success) throw notFound();
  const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId)));
  if (!p) throw notFound();
}

/** The project's live link, if any (members of every role may see it). */
export async function getShare(ctx: Ctx, projectId: string): Promise<ShareInfo | null> {
  await ownProject(ctx, projectId);
  const [row] = await db.select().from(s).where(and(eq(s.projectId, projectId), eq(s.workspaceId, ctx.workspaceId), live()));
  return row ? info(row) : null;
}

const enableInput = z.object({
  allowDuplicate: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  regenerate: z.boolean().optional(),
});

/** Turns the link on, updates its options, or (regenerate) replaces its slug so the old URL dies. */
export async function enableShare(ctx: Ctx, projectId: string, raw: unknown): Promise<ShareInfo> {
  authorize(ctx, "share");
  const input = enableInput.parse(raw ?? {});
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) throw new HttpError(400, "invalid_expiry", "Pick an expiry date in the future.");
  await ownProject(ctx, projectId);
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const [current] = await tx.select().from(s).where(and(eq(s.projectId, projectId), isNull(s.revokedAt)));
    const expired = !!current?.expiresAt && current.expiresAt.getTime() <= Date.now();
    if (current && !input.regenerate && !expired) {
      const changes = {
        ...(input.allowDuplicate !== undefined && { allowDuplicate: input.allowDuplicate }),
        ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
      };
      if (!Object.keys(changes).length) return info(current);
      const [row] = await tx.update(s).set(changes).where(eq(s.id, current.id)).returning();
      return info(row!);
    }
    if (current) await tx.update(s).set({ revokedAt: new Date() }).where(eq(s.id, current.id));
    const [row] = await tx.insert(s).values({
      workspaceId: ctx.workspaceId, projectId, slug: randomBytes(18).toString("base64url"), createdBy: ctx.userId,
      allowDuplicate: input.allowDuplicate ?? current?.allowDuplicate ?? true, expiresAt: input.expiresAt ?? null,
    }).returning();
    return info(row!);
  });
}

/** Turns the link off; the slug is 404 from the next request on. */
export async function disableShare(ctx: Ctx, projectId: string): Promise<void> {
  authorize(ctx, "share");
  await ownProject(ctx, projectId);
  await db.update(s).set({ revokedAt: new Date() }).where(and(eq(s.projectId, projectId), eq(s.workspaceId, ctx.workspaceId), isNull(s.revokedAt)));
}

async function resolveShare(slug: string) {
  if (!SLUG.test(slug)) throw notFound();
  const [row] = await db.select({ share: s, project: schema.projects }).from(s)
    .innerJoin(schema.projects, eq(schema.projects.id, s.projectId)).where(and(eq(s.slug, slug), live()));
  if (!row) throw notFound();
  return row;
}

const secret = () => {
  const v = process.env.RENDER_SECRET;
  if (!v || v.length < 32) throw new Error("RENDER_SECRET must be set (32+ characters)");
  return v;
};
const sign = (slug: string, assetId: string, part: Part, exp: string) => createHmac("sha256", secret()).update(`share-asset.${slug}.${assetId}.${part}.${exp}`).digest("hex");

export function sharedAssetUrl(slug: string, assetId: string, part: Part, now = Date.now()): string {
  const exp = String(now + ASSET_TTL_MS);
  return `/api/shared/${slug}/assets/${assetId}?part=${part}&exp=${exp}&sig=${sign(slug, assetId, part, exp)}`;
}

function verify(slug: string, assetId: string, part: string, exp: string | null, sig: string | null): part is Part {
  if (!PARTS.includes(part as Part) || !exp || !sig || !/^\d{13}$/.test(exp) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const left = Number(exp) - Date.now();
  if (left <= 0 || left > ASSET_TTL_MS + 60_000) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(sign(slug, assetId, part as Part, exp), "hex"));
}

/** Image, recording and font assets the document uses, in the share's workspace (never competitor references). */
async function usedAssets(workspaceId: string, doc: ChitrapxDoc) {
  const ids = docAssetIds(doc).filter((id) => z.uuid().safeParse(id).success);
  const families = new Set(docFontFamilies(doc));
  if (!ids.length && !families.size) return [];
  const a = schema.assets;
  const rows = await db.select({ id: a.id, kind: a.kind, sha256: a.sha256, mime: a.mime, meta: a.meta, appId: a.appId }).from(a).where(and(
    eq(a.workspaceId, workspaceId), ne(a.kind, "reference"),
    or(ids.length ? inArray(a.id, ids) : undefined, families.size ? and(eq(a.kind, "font"), isNull(a.appId)) : undefined),
  ));
  return rows.filter((r) => (r.kind === "font" ? families.has((r.meta as FontMeta | null)?.family ?? "") : ids.includes(r.id)));
}

export type SharedView = { name: string; kind: string; doc: ChitrapxDoc; assetUrls: Record<string, string>; extras: RenderExtras; allowDuplicate: boolean };

/** The public preview. An explicit allow-list: no workspace, user, app or other-project data. */
export async function sharedView(slug: string): Promise<SharedView> {
  const { share, project } = await resolveShare(slug);
  const { brand: _brand, ...rest } = migrate(project.doc);
  const doc = migrate(rest);
  const rows = await usedAssets(share.workspaceId, doc);
  const assetUrls: Record<string, string> = {};
  for (const r of rows) {
    if (r.kind === "font") continue;
    if (r.kind !== "recording") assetUrls[`asset:${r.id}`] = sharedAssetUrl(slug, r.id, "file");
    else if (r.meta?.ready) {
      assetUrls[`asset:${r.id}`] = sharedAssetUrl(slug, r.id, "webm");
      assetUrls[`asset:${r.id}#poster`] = sharedAssetUrl(slug, r.id, "poster");
    }
  }
  const faces = rows.filter((r) => r.kind === "font").map((r) => {
    const m = r.meta as FontMeta;
    return { family: m.family, weight: m.weight, italic: m.italic, format: m.format, url: sharedAssetUrl(slug, r.id, "file") };
  });
  const [app] = await db.select({ brand: schema.apps.brand }).from(schema.apps).where(eq(schema.apps.id, project.appId));
  return { name: project.name, kind: project.kind, doc, assetUrls, extras: { faces, palette: brandPalette(app?.brand) }, allowDuplicate: share.allowDuplicate };
}

/** Streams one asset of a shared project, if the signature is valid and the link and asset are still live. */
export async function sharedAsset(storage: ObjectStorage, slug: string, assetId: string, url: URL): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  const part = url.searchParams.get("part") ?? "";
  if (!z.uuid().safeParse(assetId).success || !verify(slug, assetId, part, url.searchParams.get("exp"), url.searchParams.get("sig"))) throw notFound();
  const { share, project } = await resolveShare(slug);
  const row = (await usedAssets(share.workspaceId, migrate(project.doc))).find((r) => r.id === assetId);
  if (!row) throw notFound();
  const base = `${share.workspaceId}/${row.sha256}`;
  const [path, contentType] = part === "webm" ? [`${base}.webm`, "video/webm"] : part === "poster" ? [`${base}.poster.jpg`, "image/jpeg"] : [base, row.mime];
  if (row.kind !== "recording" && part !== "file") throw notFound();
  return { body: await storage.downloadStream(path), contentType };
}

const duplicateInput = z.object({ appId: z.uuid().optional() });

/**
 * "Duplicate into my workspace": copies the shared document and the images and recordings it uses
 * into the caller's current workspace (community import path), re-pointing every `asset:` source.
 * The copy starts at revision 0 with no link and no comments.
 */
export async function duplicateShared(ctx: Ctx, storage: ObjectStorage, slug: string, raw: unknown): Promise<{ projectId: string }> {
  authorize(ctx, "edit");
  const { appId: wanted } = duplicateInput.parse(raw ?? {});
  const { share, project } = await resolveShare(slug);
  if (!share.allowDuplicate) throw new HttpError(403, "duplicate_disabled", "The owner has turned off copying for this link.");
  const appId = wanted ? (await getApp(ctx, wanted)).id
    : (await db.select({ id: schema.apps.id }).from(schema.apps).where(eq(schema.apps.workspaceId, ctx.workspaceId)).orderBy(asc(schema.apps.createdAt)).limit(1))[0]?.id;
  if (!appId) throw new HttpError(400, "no_app", "Create an app first, then copy this project into it.");
  const limit = () => new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxProjects} projects`, { limit: "projects", plan: ctx.plan, upgradeUrl: "/dashboard/billing" });
  const projectCount = async (tx = db) => ((await tx.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId))) as [{ n: number }])[0].n;
  if (await projectCount() >= PLANS[ctx.plan].maxProjects) throw limit();

  const source = migrate(project.doc);
  const relink = new Map<string, string>();
  for (const a of (await usedAssets(share.workspaceId, source)).filter((r) => r.kind !== "font")) {
    const from = `${share.workspaceId}/${a.sha256}`;
    const to = `${ctx.workspaceId}/${a.sha256}`;
    const files: Array<[string, string, string]> = [[from, to, a.mime]];
    if (a.kind === "recording" && a.meta?.ready) files.push([`${from}.webm`, `${to}.webm`, "video/webm"], [`${from}.poster.jpg`, `${to}.poster.jpg`, "image/jpeg"]);
    for (const [src, dst, mime] of files) if (!(await storage.exists(dst))) await storage.put(dst, await storage.download(src), mime);
    const [full] = await db.select().from(schema.assets).where(eq(schema.assets.id, a.id));
    await db.insert(schema.assets).values({
      workspaceId: ctx.workspaceId, appId, kind: full!.kind, storagePath: to, mime: full!.mime, width: full!.width, height: full!.height, bytes: full!.bytes, sha256: full!.sha256, meta: full!.meta,
    }).onConflictDoNothing();
    const [mine] = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
      eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, appId), eq(schema.assets.sha256, a.sha256), ne(schema.assets.kind, "reference")));
    if (!mine) throw new HttpError(409, "asset_conflict", "One of this project's images is already on this app's competitor board");
    relink.set(a.id, mine.id);
  }
  const doc = mapSources(source, (src) => {
    const id = assetIdFromSrc(src);
    return id && relink.has(id) ? src.replace(id, relink.get(id)!) : src;
  }) as ChitrapxDoc;

  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    if (await projectCount(tx) >= PLANS[ctx.plan].maxProjects) throw limit();
    const [row] = await tx.insert(schema.projects).values({
      workspaceId: ctx.workspaceId, appId, name: `${project.name} (copy)`.slice(0, 120), kind: project.kind, doc: migrate({ ...doc, brand: { appId } }), updatedBy: ctx.userId,
    }).returning({ id: schema.projects.id });
    return { projectId: row!.id };
  });
}
