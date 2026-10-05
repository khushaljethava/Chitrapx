import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { balance, db, InsufficientCreditsError, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { startAiDesign, startChips, startCopyVariants, startReferenceAnalysis, startTranslate } from "@/server/ai.ts";
import { createApp, getApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { createProject, listProjects } from "@/server/projects.ts";

let boss: PgBoss;
beforeAll(async () => {
  await seedTemplates();
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss_test" });
  await boss.start();
  for (const q of ["ai_design", "ai_translate", "ai_copy", "ai_chips", "ai_reference"]) await boss.createQueue(q);
});
afterAll(async () => { await boss.stop({ graceful: false }); });

async function setup(credits: number, shots = 1) {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" };
  if (credits) await db.insert(schema.creditLedger).values({ workspaceId: ctx.workspaceId, delta: credits, reason: "adjust" });
  const app = await createApp(ctx, { name: "Bloom" });
  for (let i = 0; i < shots; i++) {
    const sha = String(i).repeat(64);
    await db.insert(schema.assets).values({ workspaceId: ctx.workspaceId, appId: app.id, kind: "screenshot", storagePath: `${ctx.workspaceId}/${sha}`, mime: "image/png", bytes: 1, sha256: sha });
  }
  return { ctx, app };
}

describe("AI job starters", () => {
  it("design creates a project and queues a 10 credit job; without screenshots it is refused", async () => {
    const s = await setup(20);
    const { projectId } = await startAiDesign(s.ctx, boss, s.app.id, { brief: "cozy" });
    expect(await listProjects(s.ctx, s.app.id)).toEqual([expect.objectContaining({ id: projectId })]);
    expect(await balance(db, s.ctx.workspaceId)).toBe(10);
    const none = await setup(20, 0);
    await expect(startAiDesign(none.ctx, boss, none.app.id, {})).rejects.toMatchObject({ status: 400, code: "no_screenshots" });
  });

  it("design without enough credits leaves no empty project behind", async () => {
    const s = await setup(5);
    await expect(startAiDesign(s.ctx, boss, s.app.id, {})).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await listProjects(s.ctx, s.app.id)).toEqual([]);
  });

  it("translate charges per language and rejects bad or base locales; copy variants cost 3", async () => {
    const s = await setup(20);
    const p = await createProject(s.ctx, s.app.id, { name: "T", templateSlug: "amoura-dating" });
    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["../x"] })).rejects.toThrow();
    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["en-US"] })).rejects.toMatchObject({ code: "base_locale" });
    await startTranslate(s.ctx, boss, p.id, { locales: ["de-DE", "fr-FR", "ja"] });
    expect(await balance(db, s.ctx.workspaceId)).toBe(14);
    await startCopyVariants(s.ctx, boss, p.id);
    expect(await balance(db, s.ctx.workspaceId)).toBe(11);
  });
});

describe("text limits", () => {
  it("refuses to translate or rewrite more text than one job may send", async () => {
    const s = await setup(50);
    const p = await createProject(s.ctx, s.app.id, { name: "T", templateSlug: "amoura-dating" });
    const row = (await db.select().from(schema.projects).where(eq(schema.projects.id, p.id)))[0]!;
    const doc = row.doc as { groups: Array<{ boards: Array<{ elements: Array<{ type: string; content?: string }> }> }> };
    for (const el of doc.groups[0]!.boards[0]!.elements) if (el.type === "text") el.content = "w".repeat(25_000);
    await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, p.id));
    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["de-DE"] })).rejects.toMatchObject({ code: "too_much_text" });
    await expect(startCopyVariants(s.ctx, boss, p.id)).rejects.toMatchObject({ code: "too_much_text" });
  });
});

describe("AI brief (SP11)", () => {
  const inputOf = async (jobId: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]!.input;

  it("design remembers the brief on the app and sends it, serialised, to the job", async () => {
    const s = await setup(20);
    const { jobId } = await startAiDesign(s.ctx, boss, s.app.id, { brief: "For home baristas", audience: "Coffee nerds", tone: "calm", keywords: ["pour over"] });
    expect(await inputOf(jobId)).toEqual({ appId: s.app.id, brief: "For home baristas\nAudience: Coffee nerds\nTone: calm\nKeywords: pour over" });
    expect((await getApp(s.ctx, s.app.id)).brief).toEqual({ text: "For home baristas", audience: "Coffee nerds", tone: "calm", keywords: ["pour over"] });
  });

  it("a body with only the free-text brief works as before and keeps the saved fields", async () => {
    const s = await setup(30);
    await startAiDesign(s.ctx, boss, s.app.id, { brief: "first", tone: "bold" });
    const { jobId } = await startAiDesign(s.ctx, boss, s.app.id, { brief: "second" });
    expect(await inputOf(jobId)).toEqual({ appId: s.app.id, brief: "second\nTone: bold" });
  });

  it("a brief over 2000 characters is refused with a message, and nothing is created or charged", async () => {
    const s = await setup(20);
    await expect(startAiDesign(s.ctx, boss, s.app.id, { brief: "x".repeat(2001) }))
      .rejects.toMatchObject({ issues: [expect.objectContaining({ message: "Keep the brief under 2000 characters" })] });
    expect(await balance(db, s.ctx.workspaceId)).toBe(20);
    expect(await listProjects(s.ctx, s.app.id)).toEqual([]);
  });
  it("a preset is saved with the brief and passed to the job; an unknown one is refused", async () => {
    const s = await setup(20);
    const { jobId } = await startAiDesign(s.ctx, boss, s.app.id, { brief: "Budgets", preset: "finance" });
    expect(await inputOf(jobId)).toEqual({ appId: s.app.id, brief: "Budgets", preset: "finance" });
    expect((await getApp(s.ctx, s.app.id)).brief.preset).toBe("finance");
    await expect(startAiDesign(s.ctx, boss, s.app.id, { preset: "crypto-casino" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("translate from any language (SP11)", () => {
  it("takes a project language as the source, refuses an unknown one or one that is also a target, and passes overwriteManual", async () => {
    const s = await setup(20);
    const p = await createProject(s.ctx, s.app.id, { name: "T", templateSlug: "amoura-dating" });
    const row = (await db.select().from(schema.projects).where(eq(schema.projects.id, p.id)))[0]!;
    await db.update(schema.projects).set({ doc: { ...(row.doc as object), localization: { baseLocale: "en-US", locales: [{ code: "fr-FR" }] } } }).where(eq(schema.projects.id, p.id));
    const inputOf = async (jobId: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]!.input;

    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["de-DE"], sourceLocale: "it" })).rejects.toMatchObject({ code: "unknown_source_locale" });
    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["fr-FR"], sourceLocale: "fr-FR" })).rejects.toMatchObject({ code: "source_in_targets" });
    const a = await startTranslate(s.ctx, boss, p.id, { locales: ["ar-SA", "de-DE"], sourceLocale: "fr-FR", overwriteManual: true });
    expect(await inputOf(a.jobId)).toEqual({ locales: ["ar-SA", "de-DE"], sourceLocale: "fr-FR", overwriteManual: true });
    expect(await balance(db, s.ctx.workspaceId)).toBe(16);
    const b = await startTranslate(s.ctx, boss, p.id, { locales: ["de-DE"], sourceLocale: "en-US" });
    expect(await inputOf(b.jobId)).toEqual({ locales: ["de-DE"] });
  });
});

describe("chips (SP11)", () => {
  it("regenerating chips costs 1 credit and needs a chips element", async () => {
    const s = await setup(5);
    const plain = await createProject(s.ctx, s.app.id, { name: "P", templateSlug: "amoura-dating" });
    await expect(startChips(s.ctx, boss, plain.id)).rejects.toMatchObject({ code: "no_chips" });
    const fg = await createProject(s.ctx, s.app.id, { name: "F", templateSlug: "fg-habit-tracker" });
    await startChips(s.ctx, boss, fg.id);
    expect(await balance(db, s.ctx.workspaceId)).toBe(4);
  });
});

describe("competitor analysis (SP11)", () => {
  async function references(s: Awaited<ReturnType<typeof setup>>, n: number, analysed: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const hash = crypto.randomUUID().replace(/-/g, "").padEnd(64, "r");
      const [a] = await db.insert(schema.assets).values({ workspaceId: s.ctx.workspaceId, appId: s.app.id, kind: "reference", storagePath: "p", mime: "image/png", bytes: 1, sha256: hash }).returning();
      ids.push(a!.id);
      if (i < analysed) await db.insert(schema.referenceInsights).values({ workspaceId: s.ctx.workspaceId, assetId: a!.id, insight: {}, model: "m" });
    }
    return ids;
  }
  const inputOf = async (jobId: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]!.input;

  it("charges one credit per image not yet analysed; nothing on the board is refused", async () => {
    const s = await setup(5, 0);
    await expect(startReferenceAnalysis(s.ctx, boss, s.app.id)).rejects.toMatchObject({ code: "no_references" });
    const ids = await references(s, 3, 1);
    const { jobId } = await startReferenceAnalysis(s.ctx, boss, s.app.id);
    expect(await inputOf(jobId)).toEqual({ appId: s.app.id, uncached: [ids[1], ids[2]] });
    expect(await balance(db, s.ctx.workspaceId)).toBe(3);
  });

  it("a run with everything analysed is free but counts toward the hourly free allowance", async () => {
    const s = await setup(0, 0);
    await references(s, 1, 1);
    await startReferenceAnalysis(s.ctx, boss, s.app.id);
    expect(await balance(db, s.ctx.workspaceId)).toBe(0);
    for (let i = 0; i < 29; i++) await db.insert(schema.jobs).values({ workspaceId: s.ctx.workspaceId, type: "export_single", creditsReserved: 0 });
    await expect(startReferenceAnalysis(s.ctx, boss, s.app.id)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("a paid run is neither blocked by nor counted toward the free allowance (SP11 final review)", async () => {
    const s = await setup(5, 0);
    await references(s, 2, 0);
    await db.insert(schema.jobs).values(Array.from({ length: 30 }, () => ({ workspaceId: s.ctx.workspaceId, type: "export_single", creditsReserved: 0 })));
    await startReferenceAnalysis(s.ctx, boss, s.app.id); // the free allowance is used up, but this run costs 2 credits
    expect(await balance(db, s.ctx.workspaceId)).toBe(3);

    const t = await setup(0, 0);
    await references(t, 1, 1);
    await db.insert(schema.jobs).values([
      ...Array.from({ length: 29 }, () => ({ workspaceId: t.ctx.workspaceId, type: "export_single", creditsReserved: 0 })),
      ...Array.from({ length: 3 }, () => ({ workspaceId: t.ctx.workspaceId, type: "ai_reference", creditsReserved: 2 })),
    ]);
    await startReferenceAnalysis(t.ctx, boss, t.app.id); // the 30th free job: paid runs did not count
    await expect(startReferenceAnalysis(t.ctx, boss, t.app.id)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });
});
