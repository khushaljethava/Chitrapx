import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balance, db, launchSource, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import type { Ctx } from "@/server/context.ts";
import { createApp } from "@/server/apps.ts";
import { enqueueAppIcons, enqueueCollage, enqueueLogo, enqueueMockup } from "@/server/launchAssets.ts";

let boss: PgBoss;
beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss_test" });
  await boss.start();
  for (const q of ["app_icons", "logo_starter", "collage", "mockup"]) await boss.createQueue(q);
});
afterAll(async () => { await boss.stop({ graceful: false }); });

async function ctxWith(credits: number): Promise<Ctx> {
  const user = await createUser();
  const ws = await makeWorkspace(user.id);
  if (credits) await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: credits, reason: "adjust" });
  return { userId: user.id, workspaceId: ws, plan: "free" };
}

type AssetOpts = { kind?: "screenshot" | "image" | "recording"; width?: number; height?: number; bytes?: number };
async function asset(ctx: Ctx, appId: string, o: AssetOpts = {}) {
  const sha256 = randomBytes(32).toString("hex");
  const [row] = await db.insert(schema.assets).values({
    workspaceId: ctx.workspaceId, appId, kind: o.kind ?? "image", storagePath: `${ctx.workspaceId}/${sha256}`, mime: o.kind === "recording" ? "video/mp4" : "image/png",
    width: o.width ?? 1024, height: o.height ?? 1024, bytes: o.bytes ?? 1000, sha256,
  }).returning();
  return row!;
}
const jobsOf = (ctx: Ctx) => db.select().from(schema.jobs).where(eq(schema.jobs.workspaceId, ctx.workspaceId));

describe("logo enqueue", () => {
  it("is free, picks a seed when none is sent and keeps the one sent", async () => {
    const ctx = await ctxWith(0);
    const app = await createApp(ctx, { name: "Logo" });
    const picked = await enqueueLogo(ctx, boss, { appId: app.id, text: "ab" });
    expect(picked.seed).toBeGreaterThanOrEqual(0);
    expect(picked.seed).toBeLessThanOrEqual(0xffffffff);
    const kept = await enqueueLogo(ctx, boss, { appId: app.id, seed: 42 });
    expect(kept.seed).toBe(42);
    const jobs = await jobsOf(ctx);
    expect(jobs.map((j) => j.input)).toEqual(expect.arrayContaining([{ appId: app.id, text: "", seed: 42 }, { appId: app.id, text: "ab", seed: picked.seed }]));
    expect(jobs).toHaveLength(2);
    expect(await balance(db, ctx.workspaceId)).toBe(0);
  });

  it("refuses another workspace's app and a seed out of range", async () => {
    const ctx = await ctxWith(0);
    const app = await createApp(ctx, { name: "Logo" });
    await expect(enqueueLogo(await ctxWith(0), boss, { appId: app.id })).rejects.toMatchObject({ status: 404 });
    await expect(enqueueLogo(ctx, boss, { appId: app.id, seed: 2 ** 32 })).rejects.toThrow();
  });

  it("the 31st free job in an hour is refused with 429", async () => {
    const ctx = await ctxWith(0);
    const app = await createApp(ctx, { name: "Logo" });
    await db.insert(schema.jobs).values(Array.from({ length: 30 }, () => ({ workspaceId: ctx.workspaceId, type: "export_single", creditsReserved: 0 })));
    await expect(enqueueLogo(ctx, boss, { appId: app.id })).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });
});

describe("quick mockup enqueue", () => {
  it("is free and queues a one-board document of the screenshot in the device, with no project", async () => {
    const ctx = await ctxWith(0);
    const app = await createApp(ctx, { name: "Mock" });
    const shot = await asset(ctx, app.id, { kind: "screenshot", width: 1170, height: 2532 });
    const { jobId } = await enqueueMockup(ctx, boss, { assetId: shot.id, deviceType: "iphone-15", background: "#FFFFFF" });
    const [job] = await jobsOf(ctx);
    expect(job).toMatchObject({ id: jobId, type: "mockup", projectId: null, creditsReserved: 0 });
    const src = launchSource(job!);
    expect(src!.doc.groups[0]!.boards).toHaveLength(1);
    const device = src!.doc.groups[0]!.boards[0]!.elements[0] as unknown as { screenshotSrc: string; deviceType: string };
    expect(device).toMatchObject({ screenshotSrc: `asset:${shot.id}`, deviceType: "iphone-15" });
    expect(src!.doc.groups[0]!.boards[0]!.backgroundColor).toBe("#ffffff");
    expect((job!.input as { crops: unknown[] }).crops).toHaveLength(1);
  });

  it("asks for fit or fill when the shape differs, and refuses recordings and unknown devices", async () => {
    const ctx = await ctxWith(0);
    const app = await createApp(ctx, { name: "Mock" });
    const square = await asset(ctx, app.id, { width: 1000, height: 1000 });
    await expect(enqueueMockup(ctx, boss, { assetId: square.id, deviceType: "iphone-15" })).rejects.toMatchObject({ status: 400, code: "fit_required" });
    await enqueueMockup(ctx, boss, { assetId: square.id, deviceType: "iphone-15", fit: "fit" });
    const rec = await asset(ctx, app.id, { kind: "recording" });
    await expect(enqueueMockup(ctx, boss, { assetId: rec.id, deviceType: "iphone-15", fit: "fit" })).rejects.toMatchObject({ code: "not_an_image" });
    await expect(enqueueMockup(ctx, boss, { assetId: square.id, deviceType: "custom", fit: "fit" })).rejects.toThrow();
    expect(await jobsOf(ctx)).toHaveLength(1);
  });

  it("counts toward the free hourly allowance", async () => {
    const ctx = await ctxWith(0);
    const app = await createApp(ctx, { name: "Mock" });
    const shot = await asset(ctx, app.id, { width: 1000, height: 1000 });
    await db.insert(schema.jobs).values(Array.from({ length: 30 }, () => ({ workspaceId: ctx.workspaceId, type: "mockup", creditsReserved: 0 })));
    await expect(enqueueMockup(ctx, boss, { assetId: shot.id, deviceType: "iphone-15", fit: "fill" })).rejects.toMatchObject({ status: 429 });
  });
});

describe("collage enqueue", () => {
  it("reserves one credit and keeps the chosen order with each source's hash", async () => {
    const ctx = await ctxWith(3);
    const app = await createApp(ctx, { name: "Collage" });
    const [a, b, c] = [await asset(ctx, app.id), await asset(ctx, app.id, { kind: "screenshot" }), await asset(ctx, app.id)];
    await enqueueCollage(ctx, boss, { assetIds: [c.id, a.id, b.id], padding: 12, background: { from: "#FFFFFF", to: "#000000" } });
    expect(await balance(db, ctx.workspaceId)).toBe(2);
    const [job] = await jobsOf(ctx);
    expect(job).toMatchObject({ type: "collage", input: { padding: 12, background: { from: "#ffffff", to: "#000000" },
      images: [{ assetId: c.id, sha256: c.sha256 }, { assetId: a.id, sha256: a.sha256 }, { assetId: b.id, sha256: b.sha256 }] } });
    expect(launchSource(job!)).toBeNull(); // unframed: no document, no Chromium
  });

  it("with a frame, builds one mockup board per screenshot", async () => {
    const ctx = await ctxWith(3);
    const app = await createApp(ctx, { name: "Collage" });
    const shots = [await asset(ctx, app.id, { width: 1170, height: 2532 }), await asset(ctx, app.id, { width: 1170, height: 2532 })];
    await enqueueCollage(ctx, boss, { assetIds: shots.map((s) => s.id), frame: { deviceType: "iphone-15" } });
    const [job] = await jobsOf(ctx);
    const src = launchSource(job!);
    expect(src!.doc.groups[0]!.boards.map((b) => (b.elements[0] as unknown as { screenshotSrc: string }).screenshotSrc)).toEqual(shots.map((s) => `asset:${s.id}`));
    expect(src!.doc.groups[0]!.boards[0]!.backgroundColor).toBe("transparent");
    await expect(enqueueCollage(ctx, boss, { assetIds: [shots[0]!.id, (await asset(ctx, app.id, { width: 1000, height: 1000 })).id], frame: { deviceType: "iphone-15" } }))
      .rejects.toMatchObject({ code: "fit_required" });
  });

  it("rejects too few, too many, repeated, recordings and oversized images before reserving", async () => {
    const ctx = await ctxWith(3);
    const app = await createApp(ctx, { name: "Collage" });
    const ok = await asset(ctx, app.id);
    const many = [];
    for (let i = 0; i < 13; i++) many.push(await asset(ctx, app.id)); // one at a time: the shared pooler limits connections
    await expect(enqueueCollage(ctx, boss, { assetIds: [ok.id] })).rejects.toThrow();
    await expect(enqueueCollage(ctx, boss, { assetIds: many.map((m) => m.id) })).rejects.toThrow();
    await expect(enqueueCollage(ctx, boss, { assetIds: [ok.id, ok.id] })).rejects.toThrow();
    await expect(enqueueCollage(ctx, boss, { assetIds: [ok.id, (await asset(ctx, app.id, { kind: "recording" })).id] })).rejects.toMatchObject({ code: "not_an_image" });
    await expect(enqueueCollage(ctx, boss, { assetIds: [ok.id, (await asset(ctx, app.id, { width: 8001, height: 100 })).id] })).rejects.toMatchObject({ code: "image_too_large" });
    await expect(enqueueCollage(ctx, boss, { assetIds: [ok.id, (await asset(ctx, app.id, { bytes: 11 * 1024 * 1024 })).id] })).rejects.toMatchObject({ code: "too_large" });
    expect(await balance(db, ctx.workspaceId)).toBe(3);
    expect(await jobsOf(ctx)).toEqual([]);
  });
});

describe("app icons enqueue", () => {
  it("reserves one credit and stores the request with the source's hash and defaults", async () => {
    const ctx = await ctxWith(3);
    const app = await createApp(ctx, { name: "Icons" });
    const a = await asset(ctx, app.id, { width: 512, height: 512 });
    const { jobId } = await enqueueAppIcons(ctx, boss, { assetId: a.id, platforms: ["iphone", "android"], adaptiveBackground: "#ABCDEF" });
    expect(await balance(db, ctx.workspaceId)).toBe(2);
    const [job] = await jobsOf(ctx);
    expect(job).toMatchObject({ id: jobId, type: "app_icons", input: { assetId: a.id, sha256: a.sha256, platforms: ["iphone", "android"], androidName: "ic_launcher", includeStores: true, adaptiveBackground: "#abcdef" } });
  });

  it("rejects non-square, tiny, oversized and non-image sources before reserving anything", async () => {
    const ctx = await ctxWith(3);
    const app = await createApp(ctx, { name: "Icons" });
    const cases: Array<[AssetOpts, string]> = [
      [{ width: 1024, height: 1000 }, "icon_not_square"],
      [{ width: 63, height: 63 }, "icon_too_small"],
      [{ bytes: 10 * 1024 * 1024 + 1 }, "too_large"],
      [{ kind: "recording" }, "not_an_image"],
    ];
    for (const [o, code] of cases) {
      const a = await asset(ctx, app.id, o);
      await expect(enqueueAppIcons(ctx, boss, { assetId: a.id }), code).rejects.toMatchObject({ code });
    }
    await expect(enqueueAppIcons(ctx, boss, { assetId: (await asset(ctx, app.id)).id, androidName: "Bad Name" })).rejects.toThrow();
    expect(await balance(db, ctx.workspaceId)).toBe(3);
    expect(await jobsOf(ctx)).toEqual([]);
  });

  it("never reaches another workspace's image", async () => {
    const owner = await ctxWith(3);
    const a = await asset(owner, (await createApp(owner, { name: "O" })).id);
    const intruder = await ctxWith(3);
    await expect(enqueueAppIcons(intruder, boss, { assetId: a.id })).rejects.toMatchObject({ status: 404 });
  });
});
