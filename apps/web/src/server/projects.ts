import { and, asc, count, desc, eq, getTableColumns, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, lockWorkspace, PLANS, schema, withTx } from "@chitrapx/db";
import { assetIdFromSrc, emptyDoc, fillScreenshots, MAX_DOC_BYTES, migrate, projectKinds, retarget, type ChitrapxDoc, type TargetId } from "@chitrapx/document";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { badRequest, ConflictError, HttpError, notFound } from "./http.ts";
import type { ObjectStorage } from "./storage.ts";
import { getTemplate } from "./templates.ts";
import { pruneVersions } from "./versions.ts";

const name = z.string().trim().min(1).max(120);
const createInput = z.object({ name, kind: z.enum(projectKinds).optional(), templateSlug: z.string().min(1).max(120).optional() })
  .refine((v) => v.kind || v.templateSlug, { message: "Choose a template or a project type" });
const updateInput = z.object({ name });

export type Project = typeof schema.projects.$inferSelect;
export type ProjectSummary = Omit<Project, "doc">;

const own = (ctx: Ctx, id: string) => and(eq(schema.projects.id, id), eq(schema.projects.workspaceId, ctx.workspaceId));
const valid = (id: string) => { if (!z.uuid().safeParse(id).success) throw notFound(); };

export async function listProjects(ctx: Ctx, appId: string): Promise<ProjectSummary[]> {
  await getApp(ctx, appId);
  const { doc: _doc, ...cols } = getTableColumns(schema.projects);
  return db.select(cols).from(schema.projects)
    .where(and(eq(schema.projects.appId, appId), eq(schema.projects.workspaceId, ctx.workspaceId)))
    .orderBy(desc(schema.projects.updatedAt));
}

/** The starting document: a template with the app's screenshots placed in its device screens, or a blank doc. */
async function initialDoc(ctx: Ctx, appId: string, input: z.infer<typeof createInput>): Promise<ChitrapxDoc> {
  if (!input.templateSlug) return emptyDoc(input.kind!);
  const template = await getTemplate(input.templateSlug);
  if (!template) throw badRequest("unknown_template");
  const shots = await db.select({ id: schema.assets.id }).from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, appId), eq(schema.assets.kind, "screenshot")))
    .orderBy(asc(schema.assets.createdAt));
  return { ...fillScreenshots(template.doc, shots.map((a) => a.id)), brand: { appId } };
}

export async function createProject(ctx: Ctx, appId: string, raw: unknown): Promise<Project> {
  await getApp(ctx, appId);
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const [{ n }] = (await tx.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId))) as [{ n: number }];
    if (n >= PLANS[ctx.plan].maxProjects) throw new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxProjects} projects`);
    const input = createInput.parse(raw);
    const doc = await initialDoc(ctx, appId, input);
    const [project] = await tx.insert(schema.projects).values({
      workspaceId: ctx.workspaceId, appId, name: input.name, kind: doc.kind, doc, updatedBy: ctx.userId,
    }).returning();
    return project!;
  });
}

export async function updateProject(ctx: Ctx, projectId: string, raw: unknown): Promise<Project> {
  valid(projectId);
  const input = updateInput.parse(raw);
  const [project] = await db.update(schema.projects)
    .set({ name: input.name, updatedAt: new Date(), updatedBy: ctx.userId })
    .where(own(ctx, projectId)).returning();
  if (!project) throw notFound();
  return project;
}

export async function deleteProject(ctx: Ctx, projectId: string): Promise<void> {
  valid(projectId);
  const gone = await db.delete(schema.projects).where(own(ctx, projectId)).returning({ id: schema.projects.id });
  if (!gone.length) throw notFound();
}

export async function getProject(ctx: Ctx, projectId: string): Promise<Omit<Project, "doc"> & { doc: ChitrapxDoc }> {
  valid(projectId);
  const [project] = await db.select().from(schema.projects).where(own(ctx, projectId));
  if (!project) throw notFound();
  return { ...project, doc: migrate(project.doc) };
}

/** Every `asset:` source a document can reference, including per-locale overrides. */
export function docAssetIds(doc: ChitrapxDoc): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => { const id = assetIdFromSrc(typeof v === "string" ? v : null); if (id) ids.add(id); };
  const visit = (o: Record<string, unknown>) => { for (const k of ["screenshotSrc", "imageSrc", "posterSrc", "customFrameSrc", "videoSrc", "backgroundImage"]) add(o[k]); };
  for (const g of doc.groups) {
    g.spanElements.forEach((e) => visit(e as unknown as Record<string, unknown>));
    for (const b of g.boards) {
      visit(b as unknown as Record<string, unknown>);
      b.elements.forEach((e) => visit(e as unknown as Record<string, unknown>));
      for (const byEl of Object.values(b.localized ?? {})) for (const ov of Object.values(byEl)) visit(ov as Record<string, unknown>);
    }
  }
  return [...ids];
}

/**
 * Signed URLs for the document's assets that exist in this workspace, keyed by document source.
 * A processed recording maps `asset:<id>` to its WebM and `asset:<id>#poster` to its poster.
 * Paths are always rebuilt from the workspace and hash, never taken from stored values.
 */
export async function assetUrlMap(ctx: Ctx, storage: ObjectStorage, doc: ChitrapxDoc): Promise<Record<string, string>> {
  const ids = docAssetIds(doc).filter((id) => z.uuid().safeParse(id).success);
  if (!ids.length) return {};
  const rows = await db.select({ id: schema.assets.id, sha256: schema.assets.sha256, kind: schema.assets.kind, meta: schema.assets.meta }).from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), inArray(schema.assets.id, ids), ne(schema.assets.kind, "reference")));
  const entries: Array<[string, string]> = [];
  for (const r of rows) {
    const base = `${ctx.workspaceId}/${r.sha256}`;
    if (r.kind !== "recording") entries.push([`asset:${r.id}`, base]);
    else if (r.meta?.ready) entries.push([`asset:${r.id}`, `${base}.webm`], [`asset:${r.id}#poster`, `${base}.poster.jpg`]);
  }
  const urls = await storage.signedUrls(entries.map(([, path]) => path));
  return Object.fromEntries(entries.map(([src], i) => [src, urls[i]!]));
}

/** Document sources of recordings that are still converting: shown as placeholders, never export errors. */
export async function pendingAssetSrcs(ctx: Ctx, doc: ChitrapxDoc): Promise<string[]> {
  const ids = docAssetIds(doc).filter((id) => z.uuid().safeParse(id).success);
  if (!ids.length) return [];
  const rows = await db.select({ id: schema.assets.id, meta: schema.assets.meta }).from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), inArray(schema.assets.id, ids), eq(schema.assets.kind, "recording")));
  return rows.filter((r) => !r.meta?.ready).flatMap((r) => [`asset:${r.id}`, `asset:${r.id}#poster`]);
}

export { MAX_DOC_BYTES } from "@chitrapx/document";
export const AUTO_SNAPSHOT_EVERY = 20;
const saveInput = z.object({ doc: z.unknown(), revision: z.number().int().min(0) });

/**
 * Replaces the document only if the client edited the latest revision; otherwise 409 with the
 * current revision so the client can choose. Every 20th revision is kept as a version.
 */
export async function saveDoc(ctx: Ctx, projectId: string, raw: unknown): Promise<{ revision: number }> {
  valid(projectId);
  const { doc: rawDoc, revision } = saveInput.parse(raw);
  if (Buffer.byteLength(JSON.stringify(rawDoc ?? null)) > MAX_DOC_BYTES) throw new HttpError(413, "too_large", "This project is too large to save");
  const doc = migrate(rawDoc);
  return withTx(async ({ db: tx }) => {
    const [row] = await tx.update(schema.projects)
      .set({ doc, revision: sql`${schema.projects.revision} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(own(ctx, projectId), eq(schema.projects.revision, revision)))
      .returning({ revision: schema.projects.revision });
    if (!row) {
      const [current] = await tx.select({ revision: schema.projects.revision }).from(schema.projects).where(own(ctx, projectId));
      if (!current) throw notFound();
      throw new ConflictError(current.revision);
    }
    if (row.revision % AUTO_SNAPSHOT_EVERY === 0) {
      await tx.insert(schema.projectVersions).values({ workspaceId: ctx.workspaceId, projectId, revision: row.revision, doc, createdBy: ctx.userId });
      await pruneVersions(tx, ctx.workspaceId, projectId);
    }
    return { revision: row.revision };
  });
}

const SOCIAL_TARGETS: TargetId[] = ["instagram-post", "instagram-story", "x-post", "linkedin-post", "product-hunt"];

/** A new social project: the hero board of the project's first size, fitted to every social format. */
export async function createSocialProject(ctx: Ctx, projectId: string): Promise<Project> {
  const source = await getProject(ctx, projectId);
  const group = source.doc.groups[0];
  const hero = group?.boards[0];
  if (!group || !hero) throw badRequest("project_is_empty");
  const doc: ChitrapxDoc = {
    ...source.doc, kind: "social",
    groups: SOCIAL_TARGETS.map((target) => {
      const g = retarget({ ...group, boards: [JSON.parse(JSON.stringify(hero))], spanElements: [] }, target);
      return { ...g, id: `social-${target}`, boards: g.boards.map((b) => ({ ...b, id: `social-${target}-b1` })) };
    }),
  };
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const [{ n }] = (await tx.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId))) as [{ n: number }];
    if (n >= PLANS[ctx.plan].maxProjects) throw new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxProjects} projects`);
    const [project] = await tx.insert(schema.projects).values({
      workspaceId: ctx.workspaceId, appId: source.appId, name: `${source.name} (social)`, kind: "social", doc: migrate(doc), updatedBy: ctx.userId,
    }).returning();
    return project!;
  });
}
