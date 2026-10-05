import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { PgBoss } from "pg-boss";
import { db, lockWorkspace, reserveAndEnqueue, schema, withTx, type Tx } from "@chitrapx/db";
import { allLocales, checkExportable, defaultSelection, exportSelectionSchema, LOCALE_CODE, VIDEO_FORMAT_IDS, type ChitrapxDoc, type ExportSelection } from "@chitrapx/document";
import type { Ctx } from "./context.ts";
import { badRequest, HttpError, notFound } from "./http.ts";
import { getProject, pendingAssetSrcs } from "./projects.ts";
import type { ObjectStorage } from "./storage.ts";
import { pruneVersions } from "./versions.ts";

export type JobSummary = Pick<typeof schema.jobs.$inferSelect, "id" | "type" | "status" | "error" | "createdAt" | "finishedAt" | "output" | "input">;

export async function enqueueNoop(ctx: Ctx, boss: PgBoss, input: { fail: boolean }): Promise<{ jobId: string }> {
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "noop", input }));
}

export async function listJobs(ctx: Ctx, opts: { projectId?: string; limit?: number; types?: string[] } = {}): Promise<JobSummary[]> {
  return db.select({
    id: schema.jobs.id, type: schema.jobs.type, status: schema.jobs.status, error: schema.jobs.error,
    createdAt: schema.jobs.createdAt, finishedAt: schema.jobs.finishedAt, output: schema.jobs.output, input: schema.jobs.input,
  }).from(schema.jobs)
    .where(and(eq(schema.jobs.workspaceId, ctx.workspaceId), opts.projectId ? eq(schema.jobs.projectId, opts.projectId) : undefined,
      opts.types ? inArray(schema.jobs.type, opts.types) : undefined))
    .orderBy(desc(schema.jobs.createdAt)).limit(opts.limit ?? 10);
}

// Tabs opened before SP8 post `{}`: a body without `kind` is a ZIP request.
const exportBody = z.preprocess((v) => (v && typeof v === "object" && !Array.isArray(v) && !("kind" in v) ? { kind: "zip", ...v } : v), z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("zip"), selection: exportSelectionSchema.optional() }),
  z.object({ kind: z.literal("single"), groupId: z.string().min(1).max(100), boardIndex: z.number().int().min(0), locale: z.string().regex(LOCALE_CODE) }),
]));

export const FREE_JOBS_PER_HOUR = 30;
export const FREE_JOBS = ["export_single", "project_bundle", "project_import", "ai_reference"];

/** Free downloads and imports share an hourly allowance per workspace. Call inside the enqueue transaction. */
export async function assertFreeQuota(tx: Tx, workspaceId: string): Promise<void> {
  await lockWorkspace(tx.db, workspaceId);
  const [{ n }] = (await tx.db.select({ n: count() }).from(schema.jobs).where(and(
    eq(schema.jobs.workspaceId, workspaceId), inArray(schema.jobs.type, FREE_JOBS),
    gt(schema.jobs.createdAt, sql`now() - interval '1 hour'`),
  ))) as [{ n: number }];
  if (n >= FREE_JOBS_PER_HOUR) throw new HttpError(429, "rate_limited", `Free jobs are limited to ${FREE_JOBS_PER_HOUR} per hour.`);
}

/** The version row exports read, so later edits never change a queued export. One per revision. */
export async function pinVersion(tx: Tx, ctx: Ctx, project: { id: string; revision: number; doc: ChitrapxDoc }): Promise<string> {
  const [v] = await tx.db.select({ id: schema.projectVersions.id }).from(schema.projectVersions)
    .where(and(eq(schema.projectVersions.projectId, project.id), eq(schema.projectVersions.workspaceId, ctx.workspaceId),
      eq(schema.projectVersions.revision, project.revision)))
    .limit(1);
  if (v) return v.id;
  const [ins] = await tx.db.insert(schema.projectVersions).values({
    workspaceId: ctx.workspaceId, projectId: project.id, revision: project.revision, doc: project.doc, kind: "export", label: "export", createdBy: ctx.userId,
  }).returning({ id: schema.projectVersions.id });
  await pruneVersions(tx.db, ctx.workspaceId, project.id);
  return ins!.id;
}

/** A ZIP of chosen sizes and languages (1 credit), or one board as a PNG (free, limited per hour). */
export async function enqueueExport(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown): Promise<{ jobId: string }> {
  const project = await getProject(ctx, projectId);
  const body = exportBody.parse(raw ?? { kind: "zip" });
  if (!project.doc.groups.some((g) => g.boards.length)) throw badRequest("project_is_empty");
  let selection: ExportSelection;
  if (body.kind === "single") {
    const g = project.doc.groups.find((x) => x.id === body.groupId);
    if (!g?.boards[body.boardIndex]) throw badRequest("unknown_board");
    selection = { targets: [g.target], locales: [body.locale], board: { groupId: g.id, boardIndex: body.boardIndex } };
  } else selection = body.selection ?? defaultSelection(project.doc);
  if (selection.locales.some((l) => !allLocales(project.doc).includes(l))) throw badRequest("unknown_locale");
  await requireRecordingsReady(ctx, project.doc);
  const check = checkExportable(project.doc, selection);
  if (!check.ok) throw badRequest(check.code);
  const type = body.kind === "single" ? "export_single" : "export";
  return withTx(async (tx) => {
    if (type === "export_single") await assertFreeQuota(tx, ctx.workspaceId);
    const versionId = await pinVersion(tx, ctx, project);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type, input: { selection, versionId } });
  });
}

/** One job of this workspace (for following a specific job's progress). */
export async function getJob(ctx: Ctx, jobId: string): Promise<JobSummary> {
  if (!z.uuid().safeParse(jobId).success) throw notFound();
  const [job] = await db.select({
    id: schema.jobs.id, type: schema.jobs.type, status: schema.jobs.status, error: schema.jobs.error,
    createdAt: schema.jobs.createdAt, finishedAt: schema.jobs.finishedAt, output: schema.jobs.output, input: schema.jobs.input,
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

/** Paid renders never run with a recording that is converting or failed; they would show an empty screen. */
// ponytail: checks the whole document, not just the exported size; narrow it if that ever blocks someone.
async function requireRecordingsReady(ctx: Ctx, doc: Parameters<typeof pendingAssetSrcs>[1]) {
  if ((await pendingAssetSrcs(ctx, doc)).length) throw new HttpError(409, "recording_not_ready", "A screen recording in this project is not converted yet");
}

/**
 * Queues the free conversion of an uploaded recording (WebM for playback, poster, duration) unless
 * it is converted or one is already queued for the same file. Uploading a failed recording again retries it.
 */
export async function queueRecordingProcessing(ctx: Ctx, boss: PgBoss, asset: { id: string; kind: string; sha256: string; meta: { ready?: boolean; error?: string } | null }) {
  if (asset.kind !== "recording" || asset.meta?.ready) return null;
  return withTx(async (tx) => {
    // Serializes uploads of the same file so only one conversion is ever queued for it.
    await tx.client.query("select pg_advisory_xact_lock(hashtext($1))", [`rec:${ctx.workspaceId}:${asset.sha256}`]);
    const { rowCount } = await tx.client.query(
      `select 1 from jobs j join assets a on a.id::text = j.input->>'assetId'
        where j.workspace_id = $1 and j.type = 'process_recording' and j.status in ('queued', 'running')
          and a.workspace_id = $1 and a.sha256 = $2 limit 1`, [ctx.workspaceId, asset.sha256]);
    if (rowCount) return null;
    if (asset.meta?.error) {
      await tx.db.update(schema.assets).set({ meta: { ready: false } })
        .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.sha256, asset.sha256)));
    }
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "process_recording", input: { assetId: asset.id } });
  });
}

/** Charges 3 credits and queues an animated MP4 of one size's boards. */
export async function enqueueVideo(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown): Promise<{ jobId: string }> {
  const project = await getProject(ctx, projectId);
  const input = videoInput.parse(raw ?? {});
  const group = project.doc.groups.find((g) => g.id === input.groupId);
  if (!group?.boards.length) throw badRequest("project_is_empty");
  const known = [project.doc.localization.baseLocale, ...project.doc.localization.locales.map((l) => l.code)];
  if (input.locale && !known.includes(input.locale)) throw badRequest("unknown_locale");
  await requireRecordingsReady(ctx, project.doc);
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type: "video", input }));
}

export const DOWNLOAD_EXT = { export: "zip", export_single: "png", video: "mp4", project_bundle: "chitrapx" } as const;

/** A short-lived download link for a finished export, single PNG, video or project file in this workspace. */
export async function exportDownloadUrl(ctx: Ctx, storage: Pick<ObjectStorage, "signedDownload">, jobId: string): Promise<string> {
  if (!z.uuid().safeParse(jobId).success) throw notFound();
  const [job] = await db.select().from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.workspaceId, ctx.workspaceId), inArray(schema.jobs.type, Object.keys(DOWNLOAD_EXT))));
  if (!job) throw notFound();
  if (job.status !== "done") throw new HttpError(409, "not_ready");
  const ext = DOWNLOAD_EXT[job.type as keyof typeof DOWNLOAD_EXT];
  // Built from ids, never from stored output, so a download can only ever reach this workspace's files.
  return storage.signedDownload(`${ctx.workspaceId}/${job.id}.${ext}`, `chitrapx-${job.type.replace("_", "-")}-${job.id.slice(0, 8)}.${ext}`);
}

/** Free: queues a .chitrapx file of the project (document plus every referenced upload). */
export async function enqueueBundle(ctx: Ctx, boss: PgBoss, projectId: string): Promise<{ jobId: string }> {
  await getProject(ctx, projectId);
  return withTx(async (tx) => {
    await assertFreeQuota(tx, ctx.workspaceId);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type: "project_bundle", input: {} });
  });
}
