import { and, eq } from "drizzle-orm";
import { defaultSelection, exportSelectionSchema, migrate, type ChitrapxDoc, type ExportSelection } from "@chitrapx/document";
import { db, schema } from "./client.ts";

/**
 * The document and sizes an export job renders. Worker and render page both call this, so they
 * always plan the same items. Null when the pinned version or the project no longer exists.
 */
export async function exportSource(job: { workspaceId: string; projectId: string | null; input: unknown }):
  Promise<{ doc: ChitrapxDoc; selection: ExportSelection } | null> {
  const input = (job.input ?? {}) as { versionId?: string; selection?: unknown; locales?: string[] };
  if (input.versionId) {
    const [v] = await db.select({ doc: schema.projectVersions.doc, projectId: schema.projectVersions.projectId }).from(schema.projectVersions)
      .where(and(eq(schema.projectVersions.id, input.versionId), eq(schema.projectVersions.workspaceId, job.workspaceId)));
    return v && v.projectId === job.projectId ? { doc: migrate(v.doc), selection: exportSelectionSchema.parse(input.selection) } : null;
  }
  // Queued before exports were pinned: the live project, every group's own size.
  if (!job.projectId) return null;
  const [p] = await db.select({ doc: schema.projects.doc }).from(schema.projects)
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!p) return null;
  const doc = migrate(p.doc);
  const selection = defaultSelection(doc);
  return { doc, selection: input.locales?.length ? { ...selection, locales: input.locales } : selection };
}

/** Job types whose document lives in the job input (SP12): no project, nothing to hide or clean up. */
export const INLINE_DOC_JOBS = ["mockup", "collage"] as const;

/**
 * The in-memory document of a quick mockup or framed collage, validated again (colours, CSS) on
 * every read. Only the web app writes job inputs; null for other job types or anything invalid.
 */
export function launchSource(job: { type: string; input: unknown }): { doc: ChitrapxDoc; selection: ExportSelection } | null {
  if (!(INLINE_DOC_JOBS as readonly string[]).includes(job.type)) return null;
  const input = (job.input ?? {}) as { doc?: unknown; selection?: unknown };
  if (!input.doc) return null;
  try { return { doc: migrate(input.doc), selection: exportSelectionSchema.parse(input.selection) }; } catch { return null; }
}
