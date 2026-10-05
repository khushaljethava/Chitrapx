import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";
import { EXPORTS_BUCKET } from "@chitrapx/storage";
import { beforeAll, describe, expect, it } from "vitest";
import { balance, db, renderUrl, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { defaultSelection, exportPlan, fillScreenshots, migrate, type ChitrapxDoc, type ExportSelection, type TargetId } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { pngSize, runExport } from "../src/export.ts";
import { storage } from "../src/storage.ts";
import { runBundle, runImport } from "../src/bundle.ts";
import { bundleDeps } from "../src/handlers.ts";
import { runJob } from "../src/runJob.ts";

const GOLDEN = join(import.meta.dirname, "../../../packages/assets/golden");
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

async function templateDoc(slug: string): Promise<ChitrapxDoc> {
  const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, slug));
  return migrate(t!.doc);
}

/** A project plus an export job as reserveAndEnqueue leaves it (job queued, 1 credit reserved from 10). */
async function exportJob(doc: ChitrapxDoc) {
  const ws = await makeWorkspace((await createUser()).id);
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 10, reason: "adjust" });
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "E2E" }).returning();
  const [project] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: "E2E", kind: doc.kind, doc }).returning();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: project!.id, type: "export", creditsReserved: 1, input: {} }).returning();
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -1, reason: "reserve", jobId: job!.id });
  return { ws, jobId: job!.id };
}

async function zipFiles(ws: string, jobId: string): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await storage().download(`${ws}/${jobId}.zip`, EXPORTS_BUCKET)));
}

const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

beforeAll(async () => {
  const res = await fetch(`${ORIGIN}/api/health`).catch(() => null);
  if (!res?.ok) throw new Error(`web app not reachable at ${ORIGIN}; start it with pnpm dev`);
  await seedTemplates();
});

describe("export", () => {
  it("renders every board at exact store size, zips them and charges 1 credit", async () => {
    const { ws, jobId } = await exportJob(await templateDoc("amoura-dating"));
    await runJob(jobId, runExport);
    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { files: 5 } });
    const files = await zipFiles(ws, jobId);
    expect(Object.keys(files).filter((f) => f.endsWith(".png"))).toHaveLength(5);
    expect(files["report.txt"]).toBeDefined();
    for (const [name, png] of Object.entries(files).filter(([f]) => f.endsWith(".png"))) {
      expect(name).toMatch(/^ios\/iphone-6\.9\/en-US\/0\d-[a-z0-9-]+\.png$/);
      expect(pngSize(Buffer.from(png))).toEqual({ width: 1290, height: 2796 });
    }
    expect(await balance(db, ws)).toBe(9);
  });

  it("exports every board once per locale: 5 boards x 2 locales = 10 PNGs, translated text included", async () => {
    const doc = await templateDoc("amoura-dating");
    doc.localization = { baseLocale: "en-US", locales: [{ code: "de-DE" }] };
    const b0 = doc.groups[0]!.boards[0]!;
    const textId = b0.elements.find((e) => e.type === "text")!.id;
    b0.localized = { "de-DE": { [textId]: { content: "Triff jemanden Echtes" } } };
    const { ws, jobId } = await exportJob(doc);
    await runJob(jobId, runExport);
    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { files: 10 } });
    const files = await zipFiles(ws, jobId);
    expect(Object.keys(files).filter((f) => f.includes("/de-DE/"))).toHaveLength(5);
    const en = files["ios/iphone-6.9/en-US/01-meet-someone-real.png"]!;
    const de = files["ios/iphone-6.9/de-DE/01-meet-someone-real.png"]!;
    expect(Buffer.compare(Buffer.from(en), Buffer.from(de))).not.toBe(0);
  });

  it("fails by name and refunds when the document references a missing asset", async () => {
    const doc = await templateDoc("amoura-dating");
    const device = doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "device") as { screenshotSrc?: string };
    device.screenshotSrc = `asset:${crypto.randomUUID()}`;
    const { ws, jobId } = await exportJob(doc);
    await runJob(jobId, runExport);
    const job = await jobRow(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/asset_missing:asset:/);
    expect(await balance(db, ws)).toBe(10);
  });

  it("never lets a document point the export browser at an arbitrary URL", async () => {
    const doc = await templateDoc("amoura-dating");
    (doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "device") as { screenshotSrc?: string }).screenshotSrc = "http://169.254.169.254/latest/meta-data/";
    const { ws, jobId } = await exportJob(doc);
    await runJob(jobId, runExport);
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: expect.stringContaining("asset_missing:http://169.254.169.254") });
    expect(await balance(db, ws)).toBe(10);
  });

  it("the render page answers 404 unless the signature is valid and the job is running", async () => {
    const { jobId } = await exportJob(await templateDoc("amoura-dating"));
    expect((await fetch(renderUrl(ORIGIN, jobId))).status).toBe(404); // job still queued
    await db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, jobId));
    expect((await fetch(renderUrl(ORIGIN, jobId))).status).toBe(200);
    expect((await fetch(renderUrl(ORIGIN, jobId).replace(/sig=./, "sig=0"))).status).toBe(404);
    expect((await fetch(`${ORIGIN}/render/${jobId}`)).status).toBe(404);
  });
});

describe("video", () => {
  it("renders an App Preview MP4: H.264 886x1920 at 30 fps, 15 seconds, silent stereo AAC", async () => {
    const { runVideo } = await import("../src/video.ts");
    const { execFileSync } = await import("node:child_process");
    const doc = await templateDoc("amoura-dating");
    const ws = await makeWorkspace((await createUser()).id);
    await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 10, reason: "adjust" });
    const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "V" }).returning();
    const [project] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: "V", kind: "video", doc }).returning();
    const input = { groupId: doc.groups[0]!.id, format: "app-preview-portrait", secondsPerBoard: 3 };
    const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: project!.id, type: "video", creditsReserved: 3, input }).returning();
    await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -3, reason: "reserve", jobId: job!.id });
    await runJob(job!.id, runVideo);
    expect((await jobRow(job!.id)).status).toBe("done");

    const data = await storage().download(`${ws}/${job!.id}.mp4`, EXPORTS_BUCKET);
    const file = join(GOLDEN, `../.video-test-${job!.id}.mp4`);
    writeFileSync(file, data);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).toString());
    const { unlinkSync } = await import("node:fs");
    unlinkSync(file);
    const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const a = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    expect(v).toMatchObject({ codec_name: "h264", width: 886, height: 1920, pix_fmt: "yuv420p", r_frame_rate: "30/1" });
    expect(a).toMatchObject({ codec_name: "aac", channels: 2 });
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(14.9);
    expect(Number(probe.format.duration)).toBeLessThanOrEqual(30.5);
    expect(await balance(db, ws)).toBe(7);
  }, 300_000);
});

describe("video with a screen recording", () => {
  it("plays the recording inside the phone: the screen changes between 1.8 s and 2.5 s", async () => {
    const { runVideo } = await import("../src/video.ts");
    const { execFileSync } = await import("node:child_process");
    const { readFileSync: read, unlinkSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const tmp = mkdtempSync(join(tmpdir(), "rec-e2e-"));
    // A converted recording as the worker would leave it: WebM plus poster in the workspace's uploads.
    const webm = join(tmp, "r.webm"), poster = join(tmp, "p.jpg");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x780:rate=30:duration=4", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", webm]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-frames:v", "1", poster]);
    const ws = await makeWorkspace((await createUser()).id);
    await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 10, reason: "adjust" });
    const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "R" }).returning();
    const sha = crypto.randomUUID().replace(/-/g, "").padEnd(64, "0");
    await storage().put(`${ws}/${sha}.webm`, read(webm), "video/webm");
    await storage().put(`${ws}/${sha}.poster.jpg`, read(poster), "image/jpeg");
    const [asset] = await db.insert(schema.assets).values({ workspaceId: ws, appId: app!.id, kind: "recording", storagePath: `${ws}/${sha}`, mime: "video/mp4", bytes: 1, sha256: sha,
      meta: { ready: true, webm: `${ws}/${sha}.webm`, poster: `${ws}/${sha}.poster.jpg`, duration: 4, width: 360, height: 780 } }).returning();

    const doc = await templateDoc("amoura-dating");
    const b0 = doc.groups[0]!.boards[0]!;
    const i = b0.elements.findIndex((e) => e.type === "device");
    b0.elements[i] = { ...b0.elements[i]!, type: "video-device", styleType: "normal", videoSrc: `asset:${asset!.id}`, posterSrc: `asset:${asset!.id}#poster`, rotation: 0 } as never;
    const [project] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: "R", kind: "video", doc }).returning();
    const input = { groupId: doc.groups[0]!.id, format: "app-preview-portrait", secondsPerBoard: 3 };
    const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: project!.id, type: "video", creditsReserved: 3, input }).returning();
    await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -3, reason: "reserve", jobId: job!.id });
    await runJob(job!.id, runVideo);
    expect(await jobRow(job!.id)).toMatchObject({ status: "done" });

    const data = await storage().download(`${ws}/${job!.id}.mp4`, EXPORTS_BUCKET);
    const mp4 = join(tmp, "out.mp4");
    writeFileSync(mp4, data);
    const frame = (t: string) => { const f = join(tmp, `f${t}.png`); execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", t, "-i", mp4, "-frames:v", "1", f]); return PNG.sync.read(read(f)); };
    const a = frame("1.8"), b = frame("2.5"); // after entrance motion settles, before the 2.6 s crossfade
    const changed = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
    expect(changed).toBeGreaterThan(5000);
    for (const f of [webm, poster, mp4]) unlinkSync(f);
  }, 300_000);
});

describe("golden renders", () => {
  // A 2D phone set, a feature graphic and a 3D Mac board: the three renderer paths most likely to drift.
  for (const slug of ["amoura-dating", "fg-chat-connect", "mac-boardly"]) {
    it(`${slug}: first board matches the reference within 0.5% of pixels`, async () => {
      const { ws, jobId } = await exportJob(await templateDoc(slug));
      await runJob(jobId, runExport);
      expect((await jobRow(jobId)).status).toBe("done");
      const files = await zipFiles(ws, jobId);
      const first = Object.keys(files).sort()[0]!;
      const actual = PNG.sync.read(Buffer.from(files[first]!));
      const refPath = join(GOLDEN, `${slug}.png`);
      if (process.env.UPDATE_GOLDEN || !existsSync(refPath)) {
        writeFileSync(refPath, PNG.sync.write(actual));
        return;
      }
      const expected = PNG.sync.read(readFileSync(refPath));
      expect({ w: actual.width, h: actual.height }).toEqual({ w: expected.width, h: expected.height });
      const diff = pixelmatch(actual.data, expected.data, null, actual.width, actual.height, { threshold: 0.1 });
      expect(diff / (actual.width * actual.height)).toBeLessThan(0.005);
    });
  }
});

/** Fails when `png` differs from packages/assets/golden/<name> in more than 0.5% of pixels; writes it when missing or UPDATE_GOLDEN is set. */
function compareGolden(name: string, png: Buffer) {
  const actual = PNG.sync.read(png);
  const refPath = join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN || !existsSync(refPath)) { writeFileSync(refPath, PNG.sync.write(actual)); return; }
  const ref = PNG.sync.read(readFileSync(refPath));
  expect([actual.width, actual.height]).toEqual([ref.width, ref.height]);
  const diff = pixelmatch(actual.data, ref.data, null, actual.width, actual.height, { threshold: 0.1 });
  expect(diff / (actual.width * actual.height)).toBeLessThan(0.005);
}

/** A workspace with 10 credits and one app. */
async function workspaceWithApp() {
  const ws = await makeWorkspace((await createUser()).id);
  await db.update(schema.workspaces).set({ plan: "pro" }).where(eq(schema.workspaces.id, ws));
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 10, reason: "adjust" });
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "E2E" }).returning();
  return { ws, appId: app!.id };
}

/** Pins the project's current document and queues an export of `selection`, as enqueueExport does. */
async function pinnedExport(ws: string, projectId: string, selection: ExportSelection, type: "export" | "export_single" = "export") {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const [v] = await db.insert(schema.projectVersions).values({ workspaceId: ws, projectId, revision: project!.revision, doc: project!.doc }).returning();
  const cost = type === "export" ? 1 : 0;
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId, type, creditsReserved: cost, input: { selection, versionId: v!.id } }).returning();
  if (cost) await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -cost, reason: "reserve", jobId: job!.id });
  return job!.id;
}

async function newProject(ws: string, appId: string, doc: ChitrapxDoc) {
  const [p] = await db.insert(schema.projects).values({ workspaceId: ws, appId, name: "E2E", kind: doc.kind, doc }).returning();
  return p!.id;
}

describe("sizes and export (SP8)", () => {
  it("exports a derived size at its exact pixels, as RGB, with report.txt", async () => {
    const doc = await templateDoc("amoura-dating");
    const { ws, appId } = await workspaceWithApp();
    const selection = { targets: [doc.groups[0]!.target, "iphone-6.5"] as TargetId[], locales: [doc.localization.baseLocale] };
    const jobId = await pinnedExport(ws, await newProject(ws, appId, doc), selection);
    await runJob(jobId, (input, job) => runExport(input, job));
    expect((await jobRow(jobId)).status).toBe("done");
    const files = await zipFiles(ws, jobId);
    const plan = exportPlan(doc, selection);
    expect(Object.keys(files).sort()).toEqual([...plan.map((p) => p.file), "report.txt"].sort());
    for (const item of plan) {
      const png = Buffer.from(files[item.file]!);
      expect(pngSize(png)).toEqual({ width: item.width, height: item.height });
      expect(png[25]).toBe(2); // IHDR colour type 2: RGB, no alpha
    }
    expect(strFromU8(files["report.txt"]!)).toContain("Sizes made from another size");
  });

  it("renders the pinned version even when the project changes during the export", async () => {
    const doc = await templateDoc("amoura-dating");
    const { ws, appId } = await workspaceWithApp();
    const projectId = await newProject(ws, appId, doc);
    const jobId = await pinnedExport(ws, projectId, defaultSelection(doc));
    await db.update(schema.projects).set({ doc: { ...doc, groups: [] }, revision: 50 }).where(eq(schema.projects.id, projectId));
    await runJob(jobId, (input, job) => runExport(input, job));
    expect((await jobRow(jobId)).status).toBe("done");
    expect(Object.keys(await zipFiles(ws, jobId))).toHaveLength(exportPlan(doc).length + 1);
  });

  it("a single PNG matches its golden image and costs nothing", async () => {
    const doc = await templateDoc("amoura-dating");
    const { ws, appId } = await workspaceWithApp();
    const g = doc.groups[0]!;
    const jobId = await pinnedExport(ws, await newProject(ws, appId, doc),
      { targets: [g.target], locales: [doc.localization.baseLocale], board: { groupId: g.id, boardIndex: 1 } }, "export_single");
    await runJob(jobId, (input, job) => runExport(input, job, "single"));
    expect((await jobRow(jobId)).status).toBe("done");
    expect(await balance(db, ws)).toBe(10);
    compareGolden("single-amoura-02.png", await storage().download(`${ws}/${jobId}.png`, EXPORTS_BUCKET));
  });

  it("a project file imported into another app exports identical PNGs", async () => {
    const { ws, appId } = await workspaceWithApp();
    const shot = await sharp({ create: { width: 1179, height: 2556, channels: 3, background: "#3366ff" } }).png().toBuffer();
    const hash = createHash("sha256").update(shot).digest("hex");
    await storage().put(`${ws}/${hash}`, shot, "image/png");
    const [asset] = await db.insert(schema.assets).values({ workspaceId: ws, appId, kind: "screenshot", storagePath: `${ws}/${hash}`, mime: "image/png", bytes: shot.length, sha256: hash, width: 1179, height: 2556 }).returning();
    const doc = { ...fillScreenshots(await templateDoc("amoura-dating"), [asset!.id]), brand: { appId } }; // real projects carry brand.appId
    const sourceId = await newProject(ws, appId, doc);

    const [bundleJob] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: sourceId, type: "project_bundle", creditsReserved: 0 }).returning();
    await runJob(bundleJob!.id, (input, job) => runBundle(input, job, bundleDeps));
    expect((await jobRow(bundleJob!.id)).status).toBe("done");
    const file = await storage().download(`${ws}/${bundleJob!.id}.chitrapx`, EXPORTS_BUCKET);
    const uploadId = crypto.randomUUID();
    await storage().put(`staging/${ws}/${uploadId}`, file, "application/zip");

    const [target] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Target" }).returning();
    const [importJob] = await db.insert(schema.jobs).values({ workspaceId: ws, type: "project_import", creditsReserved: 0, input: { appId: target!.id, uploadId, name: "Copy" } }).returning();
    await runJob(importJob!.id, (input, job) => runImport(input, job, bundleDeps, async () => {}));
    const imported = await jobRow(importJob!.id);
    expect(imported.status).toBe("done");
    const copyId = (imported.output as { projectId: string }).projectId;

    const zips = [];
    for (const projectId of [sourceId, copyId]) {
      const jobId = await pinnedExport(ws, projectId, defaultSelection(doc));
      await runJob(jobId, (input, job) => runExport(input, job));
      expect((await jobRow(jobId)).status).toBe("done");
      zips.push(await zipFiles(ws, jobId));
    }
    const [a, b] = zips as [Record<string, Uint8Array>, Record<string, Uint8Array>];
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const name of Object.keys(a).filter((n) => n.endsWith(".png"))) {
      // Tolerance: the browser rasteriser shifts a handful of anti-aliased pixels by 1 between the source and the imported copy; any real content change exceeds it.
      const pa = PNG.sync.read(Buffer.from(a[name]!)), pb = PNG.sync.read(Buffer.from(b[name]!));
      expect([pb.width, pb.height], name).toEqual([pa.width, pa.height]);
      let differing = 0, maxChannel = 0;
      for (let i = 0; i < pa.data.length; i += 4) {
        let d = 0;
        for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(pa.data[i + c]! - pb.data[i + c]!));
        if (d) differing++;
        maxChannel = Math.max(maxChannel, d);
      }
      if (differing) console.log(`round-trip diff ${name}: ${differing} px, max channel diff ${maxChannel}`);
      expect(maxChannel, name).toBeLessThanOrEqual(1);
      expect(differing / (pa.width * pa.height), name).toBeLessThanOrEqual(0.0001);
    }
  }, 300_000);
});

describe("editor essentials (SP9)", () => {
  async function singlePng(ws: string, appId: string, doc: ChitrapxDoc) {
    const g = doc.groups[0]!;
    const id = await newProject(ws, appId, doc);
    const j = await pinnedExport(ws, id, { targets: [g.target], locales: [doc.localization.baseLocale], board: { groupId: g.id, boardIndex: 0 } }, "export_single");
    await runJob(j, (input, job) => runExport(input, job, "single"));
    expect((await jobRow(j)).status).toBe("done");
    return storage().download(`${ws}/${j}.png`, EXPORTS_BUCKET);
  }

  it("a hidden element is not in the exported PNG", async () => {
    const doc = await templateDoc("amoura-dating");
    const { ws, appId } = await workspaceWithApp();
    const shown = PNG.sync.read(await singlePng(ws, appId, doc));
    const hiddenDoc = JSON.parse(JSON.stringify(doc)) as ChitrapxDoc;
    const t = hiddenDoc.groups[0]!.boards[0]!.elements.find((e) => e.type === "text") as { hidden?: boolean };
    t.hidden = true;
    const hidden = PNG.sync.read(await singlePng(ws, appId, hiddenDoc));
    expect(pixelmatch(shown.data, hidden.data, null, shown.width, shown.height, { threshold: 0.1 })).toBeGreaterThan(1000);
  }, 180_000);

  it("an iPhone with a solid iOS status bar matches its golden image", async () => {
    const doc = await templateDoc("amoura-dating");
    const dev = doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "device") as Record<string, unknown>;
    Object.assign(dev, { deviceType: "iphone-15-pro", styleType: "normal", showStatusBar: true, statusBarPlatform: "ios", statusBarTheme: "dark", statusBarBg: "solid", statusBarColor: "#ffffff", statusBarTime: "9:41" });
    const { ws, appId } = await workspaceWithApp();
    compareGolden("status-bar-ios.png", await singlePng(ws, appId, doc));
  }, 120_000);
});
