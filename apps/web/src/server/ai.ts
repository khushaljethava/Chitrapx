import { and, asc, count, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { db, reserveAndEnqueue, schema, withTx } from "@chitrapx/db";
import { allTexts, briefFields, briefText, hasChips, LOCALE_CODE, MAX_REFERENCES_PER_APP, PRESET_KEYS, type AppBriefFields, type ChitrapxDoc } from "@chitrapx/document";
import { getApp, updateApp } from "./apps.ts";
import { assertFreeQuota } from "./jobs.ts";
import type { Ctx } from "./context.ts";
import { badRequest } from "./http.ts";
import { createProject, deleteProject, getProject } from "./projects.ts";

const designInput = z.object({
  brief: briefFields.text.optional(),
  audience: briefFields.audience.optional(),
  tone: briefFields.tone.optional(),
  keywords: briefFields.keywords.optional(),
  preset: z.enum(PRESET_KEYS).or(z.literal("")).optional(),
});
const translateInput = z.object({
  locales: z.array(z.string().regex(LOCALE_CODE)).min(1).max(20),
  sourceLocale: z.string().regex(LOCALE_CODE).optional(),
  overwriteManual: z.boolean().optional(),
});

/** Same limit the worker enforces: text sent to the model per job. */
const MAX_TEXT_CHARS = 20_000;
function assertTextFits(doc: ChitrapxDoc) {
  if (allTexts(doc).reduce((n, t) => n + t.text.length, 0) > MAX_TEXT_CHARS) throw badRequest("too_much_text");
}

const enqueue = (ctx: Ctx, boss: PgBoss, projectId: string, type: "ai_design" | "ai_translate" | "ai_copy" | "ai_chips", input: unknown) =>
  withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type, input }));

/** Creates the project the design lands in, then queues the job. If queueing fails it is removed; if the job fails, the worker removes it. */
export async function startAiDesign(ctx: Ctx, boss: PgBoss, appId: string, raw: unknown) {
  const app = await getApp(ctx, appId);
  const input = designInput.parse(raw ?? {});
  const [{ n }] = (await db.select({ n: count() }).from(schema.assets).where(and(
    eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "screenshot"),
  ))) as [{ n: number }];
  if (!n) throw badRequest("no_screenshots");
  // Remembered on the app for the next design and for copy variants; fields not sent keep their saved values.
  const patch: AppBriefFields = {};
  if (input.brief !== undefined) patch.text = input.brief;
  if (input.audience !== undefined) patch.audience = input.audience;
  if (input.tone !== undefined) patch.tone = input.tone;
  if (input.keywords !== undefined) patch.keywords = input.keywords;
  if (input.preset !== undefined) patch.preset = input.preset;
  const saved = Object.keys(patch).length ? (await updateApp(ctx, app.id, { brief: patch })).brief : app.brief;
  const brief = briefText(saved);
  const project = await createProject(ctx, app.id, { name: "AI design", kind: "screenshots" });
  try {
    const { jobId } = await enqueue(ctx, boss, project.id, "ai_design", { appId: app.id, ...(brief && { brief }), ...(saved.preset && { preset: saved.preset }) });
    return { projectId: project.id, jobId };
  } catch (err) {
    await deleteProject(ctx, project.id);
    throw err;
  }
}

export async function startTranslate(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown) {
  const project = await getProject(ctx, projectId);
  const { locales, sourceLocale, overwriteManual } = translateInput.parse(raw ?? {});
  const loc = project.doc.localization;
  if (locales.includes(loc.baseLocale)) throw badRequest("base_locale");
  const source = sourceLocale && sourceLocale !== loc.baseLocale ? sourceLocale : undefined;
  if (source && !loc.locales.some((l) => l.code === source)) throw badRequest("unknown_source_locale");
  if (source && locales.includes(source)) throw badRequest("source_in_targets");
  if (!project.doc.groups.length) throw badRequest("project_is_empty");
  assertTextFits(project.doc);
  return enqueue(ctx, boss, project.id, "ai_translate", {
    locales: [...new Set(locales)], ...(source && { sourceLocale: source }), ...(overwriteManual && { overwriteManual: true }),
  });
}

export async function startCopyVariants(ctx: Ctx, boss: PgBoss, projectId: string) {
  const project = await getProject(ctx, projectId);
  if (!project.doc.groups.length) throw badRequest("project_is_empty");
  assertTextFits(project.doc);
  return enqueue(ctx, boss, project.id, "ai_copy", {});
}

/** New feature chips for the project (1 credit). Only projects that have a chips element. */
export async function startChips(ctx: Ctx, boss: PgBoss, projectId: string) {
  const project = await getProject(ctx, projectId);
  if (!hasChips(project.doc)) throw badRequest("no_chips");
  return enqueue(ctx, boss, project.id, "ai_chips", {});
}

/** Analyses the app's competitor board: 1 credit per image not yet analysed; a run with nothing new is free but rate-limited. */
export async function startReferenceAnalysis(ctx: Ctx, boss: PgBoss, appId: string) {
  const app = await getApp(ctx, appId);
  const refs = await db.select({ id: schema.assets.id, insight: schema.referenceInsights.id }).from(schema.assets)
    .leftJoin(schema.referenceInsights, eq(schema.referenceInsights.assetId, schema.assets.id))
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "reference")))
    .orderBy(asc(schema.assets.createdAt)).limit(MAX_REFERENCES_PER_APP);
  if (!refs.length) throw badRequest("no_references");
  const uncached = refs.filter((r) => !r.insight).map((r) => r.id);
  return withTx(async (tx) => {
    // Only the free re-run (everything cached) is held to the hourly free allowance; a paid run is limited by credits.
    if (!uncached.length) await assertFreeQuota(tx, ctx.workspaceId);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "ai_reference", input: { appId: app.id, uncached } });
  });
}
