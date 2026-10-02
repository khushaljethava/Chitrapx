import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { balance, db, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { migrate, textSlots, type ChitrapxDoc } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { runAiCopy, runAiDesign, runAiTranslate, type AiDeps } from "../src/ai/jobs.ts";
import type { StructuredModel, StructuredRequest } from "../src/ai/model.ts";
import { runJob } from "../src/runJob.ts";

let png: Buffer;
beforeAll(async () => {
  await seedTemplates();
  png = await sharp({ create: { width: 300, height: 600, channels: 3, background: "#336699" } }).png().toBuffer();
});

/** Scripted model: answers by which system prompt it was given, and records every call. */
function fakeModel(answer: (req: StructuredRequest<unknown>) => unknown) {
  const calls: StructuredRequest<unknown>[] = [];
  const model: StructuredModel = {
    async generate<T>(req: StructuredRequest<T>) {
      calls.push(req as StructuredRequest<unknown>);
      return { data: req.schema.parse(answer(req as StructuredRequest<unknown>)), usage: { model: req.model, input: 100, output: 20, cacheRead: 0, cacheWrite: 0 } };
    },
  };
  return { model, calls };
}
const insight = { summary: "Log a brew", feature: "Brew logging", uiElements: ["timer"], mood: "calm", dominantColors: ["#336699"], textOnScreen: "Brew" };

async function setup(screenshots = 3, credits = 30) {
  const user = await createUser();
  const ws = await makeWorkspace(user.id, "pro");
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: credits, reason: "adjust" });
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Bloom", description: "Coffee recipes" }).returning();
  const assets = [];
  for (let i = 0; i < screenshots; i++) {
    const sha = crypto.randomUUID().replace(/-/g, "").padEnd(64, "0");
    const [a] = await db.insert(schema.assets).values({ workspaceId: ws, appId: app!.id, kind: "screenshot", storagePath: `${ws}/${sha}`, mime: "image/png", bytes: png.length, sha256: sha }).returning();
    assets.push(a!);
  }
  const [project] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: "AI", kind: "screenshots", doc: { schemaVersion: 1, kind: "screenshots", groups: [], localization: { baseLocale: "en-US", locales: [] } } }).returning();
  return { ws, app: app!, assets, project: project! };
}
async function queue(ws: string, projectId: string, type: "ai_design" | "ai_translate" | "ai_copy", input: object, cost: number) {
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId, type, input, creditsReserved: cost }).returning();
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -cost, reason: "reserve", jobId: job!.id });
  return job!.id;
}
const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;
const projectRow = async (id: string) => (await db.select().from(schema.projects).where(eq(schema.projects.id, id)))[0]!;
const deps = (model: StructuredModel): AiDeps => ({ model, loadAsset: async () => png });

async function amouraSlots() {
  const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "amoura-dating"));
  return textSlots(migrate(t!.doc));
}

describe("ai_design", () => {
  it("analyses, picks a template, writes copy, fills screens in the planned order and charges 10", async () => {
    const s = await setup(3);
    const slots = await amouraSlots();
    const { model, calls } = fakeModel((req) => {
      if (req.model === "claude-haiku-4-5") return insight;
      if (req.cachedContext) return { templateSlug: "amoura-dating", screenshotOrder: [2, 0, 1], reasoning: "fits" };
      return { boards: slots.map((b, i) => ({ boardIndex: i, texts: b.map((x) => ({ id: x.id, text: `Copy ${i}` })) })) };
    });
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id, brief: "warm" }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));

    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { templateSlug: "amoura-dating" } });
    const p = await projectRow(s.project.id);
    expect(p.revision).toBe(1);
    const doc = p.doc as ChitrapxDoc;
    const screens = doc.groups[0]!.boards.flatMap((b) => b.elements.filter((e) => e.type === "device").map((e) => (e as { screenshotSrc?: string }).screenshotSrc)).filter(Boolean);
    expect(screens.slice(0, 3)).toEqual([`asset:${s.assets[2]!.id}`, `asset:${s.assets[0]!.id}`, `asset:${s.assets[1]!.id}`]);
    const firstText = doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "text") as unknown as { content: string };
    expect(firstText.content).toBe("Copy 0");
    expect(doc.brand).toEqual({ appId: s.app.id });
    expect(calls.filter((c) => c.model === "claude-haiku-4-5")).toHaveLength(3);
    expect(calls.find((c) => c.cachedContext)?.cachedContext).toContain("amoura-dating");
    expect(await balance(db, s.ws)).toBe(20);

    // Same screenshots again: no new analysis.
    const again = fakeModel(calls.length ? (req) => (req.model === "claude-haiku-4-5" ? insight : req.cachedContext ? { templateSlug: "amoura-dating", screenshotOrder: [0], reasoning: "" } : { boards: [] }) : () => ({}));
    const job2 = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(job2, (input, job) => runAiDesign(input, job, deps(again.model)));
    expect(again.calls.filter((c) => c.model === "claude-haiku-4-5")).toHaveLength(0);
  });

  it("fails and refunds when the model names a template that does not exist", async () => {
    const s = await setup(2);
    const { model } = fakeModel((req) => (req.model === "claude-haiku-4-5" ? insight : { templateSlug: "made-up", screenshotOrder: [0, 1], reasoning: "" }));
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "ai_unknown_template" });
    expect(await balance(db, s.ws)).toBe(30);
    expect((await projectRow(s.project.id)).revision).toBe(0);
  });

  it("fails early, without calling the model, when the app has no screenshots", async () => {
    const s = await setup(0);
    const { model, calls } = fakeModel(() => insight);
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "no_screenshots" });
    expect(calls).toHaveLength(0);
    expect(await balance(db, s.ws)).toBe(30);
  });
});

describe("ai_translate", () => {
  it("translates every text into each language, keeps manual overrides, and keeps the app name", async () => {
    const s = await setup(1);
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "amoura-dating"));
    const doc = migrate(t!.doc);
    const firstId = doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "text")!.id;
    doc.groups[0]!.boards[0]!.localized = { "fr-FR": { [firstId]: { content: "Écrit à la main", origin: "manual" } } };
    doc.localization.locales = [{ code: "fr-FR" }];
    await db.update(schema.projects).set({ doc, revision: 5 }).where(eq(schema.projects.id, s.project.id));

    const { model, calls } = fakeModel((req) => {
      const texts = JSON.parse((req.content[0] as { text: string }).text) as Array<{ id: string; text: string }>;
      return { texts: texts.map((x) => ({ id: x.id, text: `[${req.system.includes("German") ? "de" : "fr"}] ${x.text}` })) };
    });
    const jobId = await queue(s.ws, s.project.id, "ai_translate", { locales: ["de-DE", "fr-FR"] }, 4);
    await runJob(jobId, (input, job) => runAiTranslate(input, job, deps(model)));

    expect((await jobRow(jobId)).status).toBe("done");
    expect(calls.every((c) => c.system.includes('"Bloom"'))).toBe(true);
    const p = await projectRow(s.project.id);
    expect(p.revision).toBe(6);
    const out = p.doc as ChitrapxDoc;
    expect(out.localization.locales.map((l) => l.code).sort()).toEqual(["de-DE", "fr-FR"]);
    expect(out.groups[0]!.boards[0]!.localized!["fr-FR"]![firstId]).toEqual({ content: "Écrit à la main", origin: "manual" });
    expect(out.groups[0]!.boards[0]!.localized!["de-DE"]![firstId]!.content).toMatch(/^\[de\] /);
    expect(await balance(db, s.ws)).toBe(26);
  });
});

describe("ai_copy", () => {
  it("returns three tone variants and leaves the document alone", async () => {
    const s = await setup(1);
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "amoura-dating"));
    await db.update(schema.projects).set({ doc: migrate(t!.doc) }).where(eq(schema.projects.id, s.project.id));
    const { model } = fakeModel(() => ({ variants: ["confident", "warm", "punchy"].map((tone) => ({ tone, texts: [{ id: "amoura-b1-headline-1-1", text: tone }] })) }));
    const jobId = await queue(s.ws, s.project.id, "ai_copy", {}, 3);
    await runJob(jobId, (input, job) => runAiCopy(input, job, deps(model)));
    const job = await jobRow(jobId);
    expect(job.status).toBe("done");
    expect((job.output as { variants: Array<{ tone: string }> }).variants.map((v) => v.tone)).toEqual(["confident", "warm", "punchy"]);
    expect((await projectRow(s.project.id)).revision).toBe(0);
  });
});
