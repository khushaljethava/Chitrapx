import { eq } from "drizzle-orm";
import { defaultSelection, type ChitrapxDoc } from "@chitrapx/document";
import { PgBoss } from "pg-boss";
import { ZodError } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balance, db, exportSource, InsufficientCreditsError, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import type { Ctx } from "@/server/context.ts";
import { enqueueExport, enqueueNoop, exportDownloadUrl, listJobs, queueRecordingProcessing } from "@/server/jobs.ts";
import { createApp } from "@/server/apps.ts";
import { createProject } from "@/server/projects.ts";
import { seedTemplates } from "@chitrapx/db/seed";

let boss: PgBoss;
beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss_test" });
  await boss.start();
  await boss.createQueue("noop");
  await boss.createQueue("export");
  await boss.createQueue("process_recording");
});
afterAll(async () => { await boss.stop({ graceful: false }); });

async function ctxWith(credits: number): Promise<Ctx> {
  const user = await createUser();
  const ws = await makeWorkspace(user.id);
  if (credits) await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: credits, reason: "adjust" });
  return { userId: user.id, workspaceId: ws, plan: "free" };
}

describe("jobs", () => {
  it("enqueueNoop reserves one credit and lists the queued job", async () => {
    const ctx = await ctxWith(3);
    const { jobId } = await enqueueNoop(ctx, boss, { fail: false });
    expect(await balance(db, ctx.workspaceId)).toBe(2);
    const jobs = await listJobs(ctx);
    expect(jobs).toEqual([expect.objectContaining({ id: jobId, type: "noop", status: "queued" })]);
  });

  it("enqueueNoop at balance 0 throws and creates no job", async () => {
    const ctx = await ctxWith(0);
    await expect(enqueueNoop(ctx, boss, { fail: false })).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await listJobs(ctx)).toEqual([]);
  });

  it("listJobs never shows another workspace's jobs", async () => {
    const a = await ctxWith(3);
    const b = await ctxWith(3);
    await enqueueNoop(a, boss, { fail: false });
    expect(await listJobs(b)).toEqual([]);
  });

  it("export charges 1 credit, validates locales, refuses empty projects", async () => {
    await seedTemplates();
    const ctx = await ctxWith(5);
    const app = await createApp(ctx, { name: "A" });
    const blank = await createProject(ctx, app.id, { name: "Blank", kind: "screenshots" });
    await expect(enqueueExport(ctx, boss, blank.id, { kind: "zip" })).rejects.toMatchObject({ status: 400, code: "project_is_empty" });
    const p = await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" });
    await expect(enqueueExport(ctx, boss, p.id, { kind: "zip", selection: { targets: ["iphone-6.9"], locales: ["xx-XX"] } })).rejects.toMatchObject({ code: "unknown_locale" });
    const { jobId } = await enqueueExport(ctx, boss, p.id, { kind: "zip" });
    expect(await balance(db, ctx.workspaceId)).toBe(4);
    expect(await listJobs(ctx, { projectId: p.id })).toEqual([expect.objectContaining({ id: jobId, type: "export", status: "queued" })]);
  });

  it("download links only for this workspace's finished exports", async () => {
    await seedTemplates();
    const ctx = await ctxWith(5);
    const app = await createApp(ctx, { name: "A" });
    const p = await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" });
    const { jobId } = await enqueueExport(ctx, boss, p.id, { kind: "zip" });
    const storage = { signedDownload: async (path: string) => `signed://${path}` };
    await expect(exportDownloadUrl(ctx, storage, jobId)).rejects.toMatchObject({ status: 409 });
    await db.update(schema.jobs).set({ status: "done" }).where(eq(schema.jobs.id, jobId));
    expect(await exportDownloadUrl(ctx, storage, jobId)).toBe(`signed://${ctx.workspaceId}/${jobId}.zip`);
    const other = await ctxWith(0);
    await expect(exportDownloadUrl(other, storage, jobId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("export guards", () => {
  it("refuses projects whose boards are not their store size", async () => {
    const { seedTemplates } = await import("@chitrapx/db/seed");
    await seedTemplates();
    const { createUser, makeWorkspace } = await import("../../../packages/db/test/helpers.ts");
    const user = await createUser();
    const ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" as const };
    const app = await createApp(ctx, { name: "A" });
    const p = await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" });
    const row = (await db.select().from(schema.projects).where(eq(schema.projects.id, p.id)))[0]!;
    const doc = row.doc as { groups: Array<{ boards: Array<{ size: { width: number; height: number } }> }> };
    doc.groups[0]!.boards[0]!.size = { width: 1000, height: 1000 };
    await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, p.id));
    const boss2 = { send: async () => "x" } as never;
    await expect(enqueueExport(ctx, boss2, p.id, { kind: "zip" })).rejects.toMatchObject({ status: 400, code: "board_size_mismatch" });
  });
});

describe("recordings", () => {
  async function recording(ctx: Ctx, appId: string, sha: string, meta: { ready: boolean; error?: string }) {
    const [a] = await db.insert(schema.assets).values({ workspaceId: ctx.workspaceId, appId, kind: "recording", storagePath: `${ctx.workspaceId}/${sha}`,
      mime: "video/mp4", bytes: 1, sha256: sha, meta }).returning();
    return a!;
  }

  it("queues one conversion per file, even for copies in other apps, and retries a failed one", async () => {
    const ctx = { ...(await ctxWith(0)), plan: "pro" as const };
    const [a, b] = [await createApp(ctx, { name: "A" }), await createApp(ctx, { name: "B" })];
    const sha = "a".repeat(64);
    const first = await recording(ctx, a.id, sha, { ready: false });
    const copy = await recording(ctx, b.id, sha, { ready: false });
    expect(await queueRecordingProcessing(ctx, boss, first)).not.toBeNull();
    expect(await queueRecordingProcessing(ctx, boss, first)).toBeNull();
    expect(await queueRecordingProcessing(ctx, boss, copy)).toBeNull();

    await db.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.workspaceId, ctx.workspaceId));
    await db.update(schema.assets).set({ meta: { ready: false, error: "recording_unreadable" } }).where(eq(schema.assets.sha256, sha));
    expect(await queueRecordingProcessing(ctx, boss, { ...copy, meta: { ready: false, error: "recording_unreadable" } })).not.toBeNull();
    const rows = await db.select({ meta: schema.assets.meta }).from(schema.assets).where(eq(schema.assets.workspaceId, ctx.workspaceId));
    expect(rows.map((r) => r.meta)).toEqual([{ ready: false }, { ready: false }]);
  });

  it("refuses a paid export while a recording in the project is not converted", async () => {
    await seedTemplates();
    const ctx = await ctxWith(5);
    const app = await createApp(ctx, { name: "A" });
    const rec = await recording(ctx, app.id, "b".repeat(64), { ready: false });
    const p = await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" });
    const doc = p.doc as ChitrapxDoc;
    const b0 = doc.groups[0]!.boards[0]!;
    const i = b0.elements.findIndex((e) => e.type === "device");
    b0.elements[i] = { ...b0.elements[i]!, type: "video-device", videoSrc: `asset:${rec.id}`, posterSrc: `asset:${rec.id}#poster` } as never;
    await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, p.id));
    await expect(enqueueExport(ctx, boss, p.id, { kind: "zip" })).rejects.toMatchObject({ status: 409, code: "recording_not_ready" });
    expect(await balance(db, ctx.workspaceId)).toBe(5);
  });
});

describe("pinned exports", () => {
  async function templateProject(credits = 5) {
    await seedTemplates();
    const ctx = await ctxWith(credits);
    const app = await createApp(ctx, { name: "A" });
    return { ctx, p: await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" }) };
  }
  const jobById = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

  it("queues a ZIP against a version of the current revision, reused by the next export", async () => {
    const { ctx, p } = await templateProject();
    const a = await jobById((await enqueueExport(ctx, boss, p.id, { kind: "zip" })).jobId);
    const b = await jobById((await enqueueExport(ctx, boss, p.id, { kind: "zip", selection: { targets: ["iphone-6.5"], locales: ["en-US"] } })).jobId);
    const ia = a.input as { versionId: string };
    const ib = b.input as { versionId: string; selection: unknown };
    expect(ia.versionId).toBe(ib.versionId);
    expect(ib.selection).toEqual({ targets: ["iphone-6.5"], locales: ["en-US"] });
    expect(await db.select().from(schema.projectVersions).where(eq(schema.projectVersions.projectId, p.id))).toHaveLength(1);
  });

  it("exportSource reads the pinned version, not later edits", async () => {
    const { ctx, p } = await templateProject();
    const job = await jobById((await enqueueExport(ctx, boss, p.id, { kind: "zip" })).jobId);
    await db.update(schema.projects).set({ doc: { ...(p.doc as object), groups: [] }, revision: 99 }).where(eq(schema.projects.id, p.id));
    expect((await exportSource(job))!.doc.groups.length).toBeGreaterThan(0);
  });

  it("exportSource runs a job queued before pinning against the live project with every group's own size", async () => {
    const { ctx, p } = await templateProject();
    const src = await exportSource({ workspaceId: ctx.workspaceId, projectId: p.id, input: { locales: ["en-US"] } });
    expect(src!.selection).toEqual({ ...defaultSelection(src!.doc), locales: ["en-US"] });
    expect(await exportSource({ workspaceId: ctx.workspaceId, projectId: crypto.randomUUID(), input: {} })).toBeNull();
  });

  it("rejects unknown languages and sizes", async () => {
    const { ctx, p } = await templateProject();
    await expect(enqueueExport(ctx, boss, p.id, { kind: "zip", selection: { targets: ["iphone-6.9"], locales: ["xx-XX"] } })).rejects.toMatchObject({ code: "unknown_locale" });
    await expect(enqueueExport(ctx, boss, p.id, { kind: "zip", selection: { targets: ["nope"], locales: ["en-US"] } })).rejects.toBeInstanceOf(ZodError);
  });
});
