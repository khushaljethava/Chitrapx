import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, PRICES, schema, withTx, type Db } from "@chitrapx/db";
import {
  allTexts, applyDesign, applyTranslations, LOCALE_CODE, migrate, repairOrder, screenInsightSchema, screenshotsPerBoard, slotCopySchema,
  templateChoiceSchema, textSlots, TONES, translationsSchema, variantsSchema,
  type CatalogEntry, type ChitrapxDoc, type ScreenInsight,
} from "@chitrapx/document";
import { FatalJobError, type FailureCleanup, type JobContext } from "../runJob.ts";
import { imageBlock } from "./images.ts";
import { MODELS, sumUsage, type StructuredModel, type Usage } from "./model.ts";
import {
  ANALYZE_SYSTEM, catalogContext, COPY_SYSTEM, copyPrompt, PICK_SYSTEM, pickPrompt, translatePrompt, translateSystem,
  VARIANTS_SYSTEM, variantsPrompt, appBrief,
} from "./prompts.ts";

export type AiDeps = { model: StructuredModel; loadAsset: (workspaceId: string, sha256: string) => Promise<Buffer> };

const MAX_SCREENSHOTS = 10;
/** Share of requested slots a model answer must cover to count as done. */
const MIN_COVERAGE = 0.8;
/** Text sent to the model per job; the web checks this first, this guards direct queueing. */
export const MAX_TEXT_CHARS = 20_000;

/** A design that failed for good leaves no empty project behind (only if nobody saved into it). */
export const cleanupFailedDesign: FailureCleanup = async (tx: Db, job) => {
  if (!job.projectId) return;
  await tx.delete(schema.projects).where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId), eq(schema.projects.revision, 0)));
};
let catalogCache: CatalogEntry[] | null = null;
const catalog = () => (catalogCache ??= JSON.parse(readFileSync(join(import.meta.dirname, "../../../../packages/assets/catalog.json"), "utf8")) as CatalogEntry[]);

/** Read-modify-write of a project document under a row lock; bumps the revision so open editors see a conflict. */
async function updateProjectDoc(job: JobContext, fn: (doc: ChitrapxDoc) => ChitrapxDoc): Promise<void> {
  if (!job.projectId) throw new FatalJobError("job_without_project");
  await withTx(async ({ client }) => {
    const r = await client.query("select doc, revision from projects where id = $1 and workspace_id = $2 for update", [job.projectId, job.workspaceId]);
    if (!r.rows[0]) throw new FatalJobError("project_missing");
    const next = migrate(fn(migrate(r.rows[0].doc)));
    await client.query("update projects set doc = $1, revision = revision + 1, updated_at = now() where id = $2", [JSON.stringify(next), job.projectId]);
  });
}

async function loadApp(job: JobContext, appId: string) {
  const [app] = await db.select().from(schema.apps).where(and(eq(schema.apps.id, appId), eq(schema.apps.workspaceId, job.workspaceId)));
  if (!app) throw new FatalJobError("app_missing");
  return app;
}

/** The job's project document and its app's row (the name is a glossary term in every language; the brief steers copy). */
async function projectDoc(job: JobContext): Promise<{ doc: ChitrapxDoc; app: typeof schema.apps.$inferSelect }> {
  if (!job.projectId) throw new FatalJobError("job_without_project");
  const [p] = await db.select({ doc: schema.projects.doc, app: schema.apps }).from(schema.projects)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.projects.appId))
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!p) throw new FatalJobError("project_missing");
  return { doc: migrate(p.doc), app: p.app };
}

/** One analysis per screenshot per workspace; cached by content hash. */
async function insightsFor(job: JobContext, assets: Array<{ sha256: string }>, deps: AiDeps, usage: Usage[]): Promise<ScreenInsight[]> {
  const out: ScreenInsight[] = [];
  for (const a of assets) {
    const [cached] = await db.select().from(schema.screenInsights)
      .where(and(eq(schema.screenInsights.workspaceId, job.workspaceId), eq(schema.screenInsights.sha256, a.sha256)));
    const valid = cached && screenInsightSchema.safeParse(cached.insight);
    if (valid && valid.success) { out.push(valid.data); continue; } // an outdated cache entry is re-analysed below
    const image = await imageBlock(await deps.loadAsset(job.workspaceId, a.sha256));
    const { data, usage: u } = await deps.model.generate({
      model: MODELS.fast, system: ANALYZE_SYSTEM, schema: screenInsightSchema, maxTokens: 2000,
      content: [image, { type: "text", text: "Describe this screenshot." }],
    });
    usage.push(u);
    await db.insert(schema.screenInsights).values({ workspaceId: job.workspaceId, sha256: a.sha256, insight: data, model: u.model })
      .onConflictDoUpdate({ target: [schema.screenInsights.workspaceId, schema.screenInsights.sha256], set: { insight: data, model: u.model } });
    out.push(data);
  }
  return out;
}

const designInput = z.object({ appId: z.uuid(), brief: z.string().max(4000).optional() });

/** Screenshots in, finished screenshot set out: analyse, pick a template, write the copy, apply. */
export async function runAiDesign(raw: unknown, job: JobContext, deps: AiDeps) {
  const input = designInput.safeParse(raw);
  if (!input.success) throw new FatalJobError("invalid_input");
  const app = await loadApp(job, input.data.appId);
  const assets = (await db.select().from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "screenshot")))
    .orderBy(asc(schema.assets.createdAt))).slice(0, MAX_SCREENSHOTS);
  if (!assets.length) throw new FatalJobError("no_screenshots");

  const usage: Usage[] = [];
  const insights = await insightsFor(job, assets, deps, usage);
  const brief = appBrief(app, { brief: input.data.brief });

  const pick = await deps.model.generate({
    model: MODELS.writer, system: PICK_SYSTEM, cachedContext: catalogContext(catalog()), schema: templateChoiceSchema, effort: "medium",
    content: [{ type: "text", text: pickPrompt(brief, insights) }],
  });
  usage.push(pick.usage);
  const [template] = await db.select().from(schema.templates)
    .where(and(eq(schema.templates.slug, pick.data.templateSlug), eq(schema.templates.kind, "screenshots")));
  if (!template) throw new FatalJobError("ai_unknown_template");
  const templateDoc = migrate(template.doc);
  const order = repairOrder(pick.data.screenshotOrder, assets.length);

  const copy = await deps.model.generate({
    model: MODELS.writer, system: COPY_SYSTEM, schema: slotCopySchema, effort: "medium",
    content: [{ type: "text", text: copyPrompt(brief, insights, order, screenshotsPerBoard(templateDoc, assets.length), textSlots(templateDoc)) }],
  });
  usage.push(copy.usage);
  // Charging for a template full of sample copy would be wrong: most slots must be written.
  const slotIds = new Set(textSlots(templateDoc).flat().map((x) => x.id));
  const written = new Set(copy.data.boards.flatMap((b) => b.texts.map((x) => x.id)).filter((id) => slotIds.has(id)));
  if (slotIds.size && written.size < slotIds.size * MIN_COVERAGE) throw new FatalJobError("ai_incomplete");

  const designed = { ...applyDesign(templateDoc, { screenshotOrder: order, boards: copy.data.boards }, assets.map((a) => a.id)), brand: { appId: app.id } };
  await updateProjectDoc(job, () => designed);
  return { actual: PRICES.ai_design, output: { templateSlug: template.slug, reasoning: pick.data.reasoning, usage: sumUsage(usage) } };
}

const translateInput = z.object({ locales: z.array(z.string().regex(LOCALE_CODE)).min(1).max(20) });
const localeName = (code: string) => { try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code; } catch { return code; } };

/** Machine-translates every text slot into each language as automatic overrides; manual ones are kept. */
export async function runAiTranslate(raw: unknown, job: JobContext, deps: AiDeps) {
  const input = translateInput.safeParse(raw);
  if (!input.success) throw new FatalJobError("invalid_input");
  const { doc, app } = await projectDoc(job);
  const texts = allTexts(doc).filter((t) => t.text.trim());
  if (!texts.length) throw new FatalJobError("nothing_to_translate");
  if (texts.reduce((n, t) => n + t.text.length, 0) > MAX_TEXT_CHARS) throw new FatalJobError("too_much_text");
  const glossary = [app.name].filter(Boolean);

  const usage: Usage[] = [];
  const results: Array<{ locale: string; texts: Array<{ id: string; text: string }> }> = [];
  for (const locale of input.data.locales) {
    if (locale === doc.localization.baseLocale) continue;
    const { data, usage: u } = await deps.model.generate({
      model: MODELS.fast, system: translateSystem(localeName(locale), glossary), schema: translationsSchema,
      content: [{ type: "text", text: translatePrompt(texts) }],
    });
    usage.push(u);
    const known = new Set(texts.map((t) => t.id));
    const usable = data.texts.filter((t) => known.has(t.id) && t.text.trim());
    if (usable.length < texts.length * MIN_COVERAGE) continue; // not charged; reported below
    results.push({ locale, texts: usable });
  }
  if (!results.length) throw new FatalJobError("ai_incomplete");
  // Applied to the latest document under the lock: edits made meanwhile are kept, and a slot whose
  // base text changed while translating is skipped rather than given a stale translation.
  const sources = new Map(texts.map((t) => [t.id, t.text]));
  await updateProjectDoc(job, (current) => results.reduce((d, r) => applyTranslations(d, r.locale, r.texts, sources), current));
  const skipped = input.data.locales.filter((l) => !results.some((r) => r.locale === l));
  return { actual: PRICES.ai_translate * results.length, output: { locales: results.map((r) => r.locale), skipped, usage: sumUsage(usage) } };
}

/** Three alternative copy sets; the editor applies one. Never changes the document itself. */
export async function runAiCopy(_raw: unknown, job: JobContext, deps: AiDeps) {
  const { doc, app } = await projectDoc(job);
  const texts = allTexts(doc).filter((t) => t.text.trim());
  if (!texts.length) throw new FatalJobError("nothing_to_rewrite");
  if (texts.reduce((n, t) => n + t.text.length, 0) > MAX_TEXT_CHARS) throw new FatalJobError("too_much_text");
  const { data, usage } = await deps.model.generate({
    model: MODELS.writer, system: VARIANTS_SYSTEM, schema: variantsSchema, effort: "medium",
    content: [{ type: "text", text: variantsPrompt(appBrief(app), texts) }],
  });
  const known = new Set(texts.map((t) => t.id));
  const variants = TONES.map((tone) => ({ tone, texts: (data.variants.find((v) => v.tone === tone)?.texts ?? []).filter((t) => known.has(t.id)) }))
    .filter((v) => v.texts.length);
  if (!variants.length) throw new FatalJobError("ai_no_variants");
  return { actual: PRICES.ai_copy, output: { variants, usage: sumUsage([usage]) } };
}
