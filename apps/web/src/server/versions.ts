import { and, desc, eq, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { db, schema, withTx, type Db } from "@chitrapx/db";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import type { Ctx } from "./context.ts";
import { ConflictError, notFound } from "./http.ts";

/** Automatic versions (autosave, export, before-restore) kept per project; named versions are never pruned. */
export const VERSIONS_KEPT = 50;
const LIST_LIMIT = 100;

export type VersionKind = "auto" | "export" | "restore" | "named";
export type VersionSummary = { id: string; revision: number; kind: VersionKind; label: string | null; createdAt: Date; author: string | null };

const uuid = (id: string) => { if (!z.uuid().safeParse(id).success) throw notFound(); };
const v = schema.projectVersions;
const summary = { id: v.id, revision: v.revision, kind: v.kind, label: v.label, createdAt: v.createdAt, author: authUsers.email };

async function ownProject(ctx: Ctx, projectId: string) {
  uuid(projectId);
  const [p] = await db.select({ id: schema.projects.id, revision: schema.projects.revision, doc: schema.projects.doc }).from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId)));
  if (!p) throw notFound();
  return p;
}

/**
 * Keeps the newest VERSIONS_KEPT automatic versions of a project. Never deletes named versions or
 * a version that a queued or running job still reads (export jobs store it in input.versionId).
 */
export async function pruneVersions(tx: Db, workspaceId: string, projectId: string): Promise<void> {
  await tx.execute(sql`
    delete from project_versions pv
    where pv.project_id = ${projectId} and pv.workspace_id = ${workspaceId} and pv.kind <> 'named'
      and pv.id not in (
        select id from project_versions
        where project_id = ${projectId} and kind <> 'named'
        order by created_at desc, id desc limit ${VERSIONS_KEPT})
      and not exists (
        select 1 from jobs j
        where j.project_id = ${projectId} and j.status in ('queued', 'running') and j.input->>'versionId' = pv.id::text)`);
}

export async function listVersions(ctx: Ctx, projectId: string): Promise<VersionSummary[]> {
  await ownProject(ctx, projectId);
  const rows = await db.select(summary).from(v).leftJoin(authUsers, eq(authUsers.id, v.createdBy))
    .where(and(eq(v.projectId, projectId), eq(v.workspaceId, ctx.workspaceId)))
    .orderBy(desc(v.createdAt), desc(v.id)).limit(LIST_LIMIT);
  return rows as VersionSummary[];
}

export async function getVersion(ctx: Ctx, projectId: string, versionId: string): Promise<VersionSummary & { doc: ChitrapxDoc }> {
  await ownProject(ctx, projectId);
  uuid(versionId);
  const [row] = await db.select({ ...summary, doc: v.doc }).from(v).leftJoin(authUsers, eq(authUsers.id, v.createdBy))
    .where(and(eq(v.id, versionId), eq(v.projectId, projectId), eq(v.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound();
  const { doc, ...rest } = row;
  return { ...(rest as VersionSummary), doc: migrate(doc) };
}

const namedInput = z.object({ label: z.string().trim().min(1).max(80) });

/** Saves the project's current saved document as a named version (never pruned). */
export async function saveNamedVersion(ctx: Ctx, projectId: string, raw: unknown): Promise<VersionSummary> {
  const { label } = namedInput.parse(raw);
  const p = await ownProject(ctx, projectId);
  const [row] = await db.insert(v).values({ workspaceId: ctx.workspaceId, projectId, revision: p.revision, doc: p.doc, kind: "named", label, createdBy: ctx.userId })
    .returning({ id: v.id, revision: v.revision, kind: v.kind, label: v.label, createdAt: v.createdAt });
  return { ...(row as Omit<VersionSummary, "author">), author: null };
}

const restoreInput = z.object({ revision: z.number().int().min(0) });

/**
 * Makes a version the current document. History is never rewound: the current document is saved
 * first as "Before restore", and the restored document becomes a new revision. A stale revision
 * is a 409 conflict and changes nothing. Another workspace always gets 404 (checked first).
 */
export async function restoreVersion(ctx: Ctx, projectId: string, versionId: string, raw: unknown): Promise<{ revision: number; doc: ChitrapxDoc }> {
  const { revision } = restoreInput.parse(raw);
  uuid(projectId); uuid(versionId);
  return withTx(async ({ db: tx }) => {
    const [p] = await tx.select({ revision: schema.projects.revision, doc: schema.projects.doc }).from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId))).for("update");
    if (!p) throw notFound();
    const [ver] = await tx.select({ doc: v.doc }).from(v).where(and(eq(v.id, versionId), eq(v.projectId, projectId), eq(v.workspaceId, ctx.workspaceId)));
    if (!ver) throw notFound();
    if (p.revision !== revision) throw new ConflictError(p.revision);
    const doc = migrate(ver.doc);
    await tx.insert(v).values({ workspaceId: ctx.workspaceId, projectId, revision: p.revision, doc: p.doc, kind: "restore", label: "Before restore", createdBy: ctx.userId });
    const [row] = await tx.update(schema.projects).set({ doc, revision: p.revision + 1, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId))).returning({ revision: schema.projects.revision });
    await pruneVersions(tx, ctx.workspaceId, projectId);
    return { revision: row!.revision, doc };
  });
}
