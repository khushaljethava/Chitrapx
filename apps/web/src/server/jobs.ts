import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { PgBoss } from "pg-boss";
import { db, reserveAndEnqueue, schema, withTx } from "@chitrapx/db";
import { checkExportable, LOCALE_CODE, VIDEO_FORMAT_IDS } from "@chitrapx/document";
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

const videoInput = z.object({
  groupId: z.string().min(1),
  format: z.enum(VIDEO_FORMAT_IDS),
  locale: z.string().regex(LOCALE_CODE).optional(),
  secondsPerBoard: z.number().min(2).max(6).default(3),
});

/** Queues the free conversion of an uploaded recording (WebM for playback, poster, duration). */
export async function queueRecordingProcessing(ctx: Ctx, boss: PgBoss, asset: { id: string; kind: string; meta: { ready?: boolean; error?: string } | null }) {
  if (asset.kind !== "recording" || asset.meta?.ready || asset.meta?.error) return null;
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "process_recording", input: { assetId: asset.id } }));
}

/** Charges 3 credits and queues an animated MP4 of one size's boards. */
export async function enqueueVideo(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown): Promise<{ jobId: string }> {
  const project = await getProject(ctx, projectId);
  const input = videoInput.parse(raw ?? {});
  const group = project.doc.groups.find((g) => g.id === input.groupId);
  if (!group?.boards.length) throw badRequest("project_is_empty");
  const known = [project.doc.localization.baseLocale, ...project.doc.localization.locales.map((l) => l.code)];
  if (input.locale && !known.includes(input.locale)) throw badRequest("unknown_locale");
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type: "video", input }));
}

/** A short-lived download link for a finished export (ZIP) or video (MP4) in this workspace. */
export async function exportDownloadUrl(ctx: Ctx, storage: Pick<ObjectStorage, "signedDownload">, jobId: string): Promise<string> {
  if (!z.uuid().safeParse(jobId).success) throw notFound();
  const [job] = await db.select().from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.workspaceId, ctx.workspaceId), inArray(schema.jobs.type, ["export", "video"])));
  if (!job) throw notFound();
  if (job.status !== "done") throw new HttpError(409, "not_ready");
  const ext = job.type === "video" ? "mp4" : "zip";
  // Built from ids, never from stored output, so a download can only ever reach this workspace's files.
  return storage.signedDownload(`${ctx.workspaceId}/${job.id}.${ext}`, `chitrapx-${job.type}-${job.id.slice(0, 8)}.${ext}`);
}
