import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { balance, db, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { allTexts, migrate, textSlots, type ChitrapxDoc } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { runAiChips, runAiCopy, runAiDesign, runAiTranslate, type AiDeps } from "../src/ai/jobs.ts";
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
async function queue(ws: string, projectId: string, type: "ai_design" | "ai_translate" | "ai_copy" | "ai_chips" | "ai_reference", input: object, cost: number) {
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

  it("copy variants use the app's stored brief", async () => {
    const s = await setup(1);
    await db.update(schema.apps).set({ brief: { text: "For home baristas", keywords: ["pour over"] } }).where(eq(schema.apps.id, s.app.id));
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "amoura-dating"));
    await db.update(schema.projects).set({ doc: migrate(t!.doc) }).where(eq(schema.projects.id, s.project.id));
    const { model, calls } = fakeModel(() => ({ variants: ["confident", "warm", "punchy"].map((tone) => ({ tone, texts: [{ id: "amoura-b1-headline-1-1", text: tone }] })) }));
    const jobId = await queue(s.ws, s.project.id, "ai_copy", {}, 3);
    await runJob(jobId, (input, job) => runAiCopy(input, job, deps(model)));
    expect((await jobRow(jobId)).status).toBe("done");
    expect((calls[0]!.content[0] as { text: string }).text).toContain("Brief: For home baristas\nKeywords: pour over");
  });
});

describe("review fixes", () => {
  it("a failed design removes the empty project it was created for", async () => {
    const { cleanupFailedDesign } = await import("../src/ai/jobs.ts");
    const s = await setup(2);
    const { model } = fakeModel((req) => (req.model === "claude-haiku-4-5" ? insight : { templateSlug: "made-up", screenshotOrder: [0], reasoning: "" }));
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)), cleanupFailedDesign);
    expect(await db.select().from(schema.projects).where(eq(schema.projects.id, s.project.id))).toEqual([]);
  });

  it("design copy that misses most slots fails and refunds instead of charging for sample text", async () => {
    const s = await setup(2);
    const { model } = fakeModel((req) => (req.model === "claude-haiku-4-5" ? insight : req.cachedContext ? { templateSlug: "amoura-dating", screenshotOrder: [0, 1], reasoning: "" } : { boards: [{ boardIndex: 0, texts: [{ id: "nope", text: "x" }] }] }));
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "ai_incomplete" });
    expect(await balance(db, s.ws)).toBe(30);
  });

  it("translate charges only for languages it translated and fails when nothing usable came back", async () => {
    const s = await setup(1);
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "amoura-dating"));
    await db.update(schema.projects).set({ doc: migrate(t!.doc) }).where(eq(schema.projects.id, s.project.id));
    const empty = fakeModel(() => ({ texts: [{ id: "nope", text: "x" }] }));
    const bad = await queue(s.ws, s.project.id, "ai_translate", { locales: ["de-DE"] }, 2);
    await runJob(bad, (input, job) => runAiTranslate(input, job, deps(empty.model)));
    expect(await jobRow(bad)).toMatchObject({ status: "failed", error: "ai_incomplete" });
    expect(await balance(db, s.ws)).toBe(30);
  });

  it("a cached insight that no longer validates is re-analysed, not fatal", async () => {
    const s = await setup(1);
    await db.insert(schema.screenInsights).values({ workspaceId: s.ws, sha256: s.assets[0]!.sha256, insight: { old: true }, model: "x" });
    const slots = await amouraSlots();
    const { model, calls } = fakeModel((req) => req.model === "claude-haiku-4-5" ? insight : req.cachedContext
      ? { templateSlug: "amoura-dating", screenshotOrder: [0], reasoning: "" }
      : { boards: slots.map((b, i) => ({ boardIndex: i, texts: b.map((x) => ({ id: x.id, text: "ok" })) })) });
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));
    expect((await jobRow(jobId)).status).toBe("done");
    expect(calls.filter((c) => c.model === "claude-haiku-4-5")).toHaveLength(1);
  });
});

describe("translate from another language (SP11)", () => {
  /** amoura with every text in French; the first one also hand-written in Arabic and German. */
  async function frenchProject(s: Awaited<ReturnType<typeof setup>>) {
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "amoura-dating"));
    const doc = migrate(t!.doc);
    for (const g of doc.groups) for (const b of g.boards) for (const e of b.elements) {
      if (e.type === "text") ((b.localized ??= {})["fr-FR"] ??= {})[e.id] = { content: `FR ${(e as unknown as { content: string }).content}`, origin: "auto" };
    }
    const b0 = doc.groups[0]!.boards[0]!;
    const firstId = b0.elements.find((e) => e.type === "text")!.id;
    b0.localized!["ar-SA"] = { [firstId]: { content: "مكتوب يدويا", origin: "manual" } };
    b0.localized!["de-DE"] = { [firstId]: { content: "Von Hand", origin: "manual" } };
    doc.localization.locales = [{ code: "fr-FR" }, { code: "ar-SA" }, { code: "de-DE" }];
    await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, s.project.id));
    return { doc, firstId };
  }

  it("translates ar-SA and de-DE from fr-FR, keeps the hand-written cell, and charges only the language that came back", async () => {
    const s = await setup(1);
    await db.update(schema.apps).set({ glossary: ["Pour-over Pro"] }).where(eq(schema.apps.id, s.app.id));
    const { doc, firstId } = await frenchProject(s);
    const { model, calls } = fakeModel((req) => {
      const sent = JSON.parse((req.content[0] as { text: string }).text) as Array<{ id: string; text: string }>;
      if (req.system.includes("German")) return { texts: [] }; // German fails: skipped, not charged
      return { texts: sent.map((x) => ({ id: x.id, text: `AR ${x.text}` })) };
    });
    const jobId = await queue(s.ws, s.project.id, "ai_translate", { locales: ["ar-SA", "de-DE"], sourceLocale: "fr-FR" }, 4);
    await runJob(jobId, (input, job) => runAiTranslate(input, job, deps(model)));

    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { locales: ["ar-SA"], skipped: ["de-DE"] } });
    expect(calls.every((c) => c.system.includes("from French") && c.system.includes('"Pour-over Pro"') && c.system.includes('"Bloom"'))).toBe(true);
    const sent = JSON.parse((calls[0]!.content[0] as { text: string }).text) as Array<{ text: string }>;
    expect(sent.every((x) => x.text.startsWith("FR "))).toBe(true);
    const out = (await projectRow(s.project.id)).doc as ChitrapxDoc;
    expect(out.groups[0]!.boards[0]!.localized!["ar-SA"]![firstId]).toEqual({ content: "مكتوب يدويا", origin: "manual" });
    const other = allTexts(doc).find((x) => x.id !== firstId && x.text.trim())!;
    const where = out.groups[0]!.boards.find((b) => b.elements.some((e) => e.id === other.id))!;
    expect(where.localized!["ar-SA"]![other.id]!.content).toMatch(/^AR FR /);
    expect(await balance(db, s.ws)).toBe(28);
  });

  it("overwriteManual replaces a hand-written cell", async () => {
    const s = await setup(1);
    const { firstId } = await frenchProject(s);
    const { model } = fakeModel((req) => ({ texts: (JSON.parse((req.content[0] as { text: string }).text) as Array<{ id: string; text: string }>).map((x) => ({ id: x.id, text: `[de] ${x.text}` })) }));
    const jobId = await queue(s.ws, s.project.id, "ai_translate", { locales: ["de-DE"], overwriteManual: true }, 2);
    await runJob(jobId, (input, job) => runAiTranslate(input, job, deps(model)));
    const out = (await projectRow(s.project.id)).doc as ChitrapxDoc;
    expect(out.groups[0]!.boards[0]!.localized!["de-DE"]![firstId]).toMatchObject({ content: expect.stringMatching(/^\[de\] /), origin: "auto" });
  });
});

describe("ai_chips (SP11)", () => {
  /** A Habit Tracker feature graphic whose chips already have a German translation. */
  async function chipsProject(s: Awaited<ReturnType<typeof setup>>) {
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "fg-habit-tracker"));
    const doc = migrate(t!.doc);
    doc.localization.locales = [{ code: "de-DE" }];
    doc.groups[0]!.boards[0]!.localized = { "de-DE": { "habit-chips": { chips: ["Tägliche Serien"], origin: "auto" } } };
    await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, s.project.id));
    return doc;
  }
  const chipsIn = (d: ChitrapxDoc) => (d.groups[0]!.boards[0]!.elements.find((e) => e.type === "chips") as unknown as { chips: string[] }).chips;

  it("replaces only the chips, drops their old translations and charges 1", async () => {
    const s = await setup(1);
    const before = await chipsProject(s);
    const { model, calls } = fakeModel(() => ({ features: ["Brew timer", "Recipes", "Bean log", "Recipes", "Grind guide", "A very long feature name"] }));
    const jobId = await queue(s.ws, s.project.id, "ai_chips", {}, 1);
    await runJob(jobId, (input, job) => runAiChips(input, job, deps(model)));

    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { chips: ["Brew timer", "Recipes", "Bean log", "Grind guide"] } });
    const out = (await projectRow(s.project.id)).doc as ChitrapxDoc;
    expect(chipsIn(out)).toEqual(["Brew timer", "Recipes", "Bean log", "Grind guide"]);
    const texts = (d: ChitrapxDoc) => d.groups[0]!.boards[0]!.elements.filter((e) => e.type === "text");
    expect(texts(out)).toEqual(texts(before));
    expect(out.groups[0]!.boards[0]!.localized?.["de-DE"]?.["habit-chips"]).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain("feature chips");
    expect(await balance(db, s.ws)).toBe(29);
  });

  it("fails and refunds when fewer than four usable chips come back", async () => {
    const s = await setup(1);
    const before = await chipsProject(s);
    const { model } = fakeModel(() => ({ features: ["One", "Two", "Three words here"] }));
    const jobId = await queue(s.ws, s.project.id, "ai_chips", {}, 1);
    await runJob(jobId, (input, job) => runAiChips(input, job, deps(model)));
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "ai_incomplete" });
    expect(chipsIn((await projectRow(s.project.id)).doc as ChitrapxDoc)).toEqual(chipsIn(before));
    expect(await balance(db, s.ws)).toBe(30);
  });
});
