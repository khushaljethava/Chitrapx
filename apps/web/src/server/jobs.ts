import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { PgBoss } from "pg-boss";
import { db, reserveAndEnqueue, schema, withTx } from "@chitrapx/db";
import { checkExportable } from "@chitrapx/document";
import type { Ctx } from "./context.ts";
import { badRequest, HttpError, notFound } from "./http.ts";
import { getProject } from "./projects.ts";
import type { ObjectStorage } from "./storage.ts";

export type JobSummary = Pick<typeof schema.jobs.$inferSelect, "id" | "type" | "status" | "error" | "createdAt" | "finishedAt" | "output">;

export async function enqueueNoop(ctx: Ctx, boss: PgBoss, input: { fail: boolean }): Promise<{ jobId: string }> {
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "noop", input }));
}

export async function listJobs(ctx: Ctx, opts: { projectId?: string; limit?: number } = {}): Promise<JobSummary[]> {
  return db.select({
    id: schema.jobs.id, type: schema.jobs.type, status: schema.jobs.status, error: schema.jobs.error,
    createdAt: schema.jobs.createdAt, finishedAt: schema.jobs.finishedAt, output: schema.jobs.output,
  }).from(schema.jobs)
    .where(and(eq(schema.jobs.workspaceId, ctx.workspaceId), opts.projectId ? eq(schema.jobs.projectId, opts.projectId) : undefined))
    .orderBy(desc(schema.jobs.createdAt)).limit(opts.limit ?? 10);
}

const exportInput = z.object({ locales: z.array(z.string().min(2).max(20)).max(50).optional() });

/** Charges 1 credit and queues a ZIP of every board in the chosen locales (all by default). */
export async function enqueueExport(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown): Promise<{ jobId: string }> {
  const project = await getProject(ctx, projectId);
  const { locales } = exportInput.parse(raw ?? {});
  if (!project.doc.groups.some((g) => g.boards.length)) throw badRequest("project_is_empty");
  const known = [project.doc.localization.baseLocale, ...project.doc.localization.locales.map((l) => l.code)];
  if (locales?.some((l) => !known.includes(l))) throw badRequest("unknown_locale");
  const check = checkExportable(project.doc, locales);
  if (!check.ok) throw badRequest(check.code);
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type: "export", input: { locales } }));
}

/** One job of this workspace (for following a specific job's progress). */
export async function getJob(ctx: Ctx, jobId: string): Promise<JobSummary> {
  if (!z.uuid().safeParse(jobId).success) throw notFound();
  const [job] = await db.select({
    id: schema.jobs.id, type: schema.jobs.type, status: schema.jobs.status, error: schema.jobs.error,
    createdAt: schema.jobs.createdAt, finishedAt: schema.jobs.finishedAt, output: schema.jobs.output,
  }).from(schema.jobs).where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.workspaceId, ctx.workspaceId)));
  if (!job) throw notFound();
  return job;
}

/** A short-lived download link for a finished export in this workspace. */
export async function exportDownloadUrl(ctx: Ctx, storage: Pick<ObjectStorage, "signedDownload">, jobId: string): Promise<string> {
  if (!z.uuid().safeParse(jobId).success) throw notFound();
  const [job] = await db.select().from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.workspaceId, ctx.workspaceId), eq(schema.jobs.type, "export")));
  if (!job) throw notFound();
  if (job.status !== "done") throw new HttpError(409, "not_ready");
  return storage.signedDownload(`${ctx.workspaceId}/${job.id}.zip`, `chitrapx-export-${job.id.slice(0, 8)}.zip`);
}
