import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { balance, db, renderUrl, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { EXPORTS_BUCKET, pngSize, runExport } from "../src/export.ts";
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
  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).storage;
  const { data, error } = await storage.from(EXPORTS_BUCKET).download(`${ws}/${jobId}.zip`);
  if (error) throw error;
  return unzipSync(new Uint8Array(await data.arrayBuffer()));
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

    const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).storage;
    const { data } = await storage.from(EXPORTS_BUCKET).download(`${ws}/${job!.id}.mp4`);
    const file = join(GOLDEN, `../.video-test-${job!.id}.mp4`);
    writeFileSync(file, Buffer.from(await data!.arrayBuffer()));
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
    const uploads = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).storage.from("uploads");
    await uploads.upload(`${ws}/${sha}.webm`, read(webm), { contentType: "video/webm", upsert: true });
    await uploads.upload(`${ws}/${sha}.poster.jpg`, read(poster), { contentType: "image/jpeg", upsert: true });
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

    const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).storage;
    const { data } = await storage.from(EXPORTS_BUCKET).download(`${ws}/${job!.id}.mp4`);
    const mp4 = join(tmp, "out.mp4");
    writeFileSync(mp4, Buffer.from(await data!.arrayBuffer()));
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
