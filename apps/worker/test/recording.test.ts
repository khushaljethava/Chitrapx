import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { markRecordingFailed, processRecording, type RecordingDeps } from "../src/recording.ts";
import { runJob } from "../src/runJob.ts";

const dir = mkdtempSync(join(tmpdir(), "rec-test-"));
const sample = join(dir, "sample.mp4");
beforeAll(() => {
  // A 3 second portrait H.264 clip whose content changes over time.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x780:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", sample]);
});

function deps(source: string, uploaded: Map<string, string>): RecordingDeps {
  return {
    async download(_ws, _sha, dest) { copyFileSync(source, dest); },
    async upload(path, file) { const keep = join(dir, path.replace(/\//g, "_")); copyFileSync(file, keep); uploaded.set(path, keep); },
  };
}

async function recordingJob() {
  const ws = await makeWorkspace((await createUser()).id);
  const sha = crypto.randomUUID().replace(/-/g, "").padEnd(64, "0");
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "R" }).returning();
  const [asset] = await db.insert(schema.assets).values({ workspaceId: ws, appId: app!.id, kind: "recording", storagePath: `${ws}/${sha}`, mime: "video/mp4", bytes: 1, sha256: sha, meta: { ready: false } }).returning();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, type: "process_recording", creditsReserved: 0, input: { assetId: asset!.id } }).returning();
  return { ws, sha, asset: asset!, jobId: job!.id };
}
const assetRow = async (id: string) => (await db.select().from(schema.assets).where(eq(schema.assets.id, id)))[0]!;

describe("process_recording", () => {
  it("converts to VP9 WebM with a poster, duration and size", async () => {
    const r = await recordingJob();
    const uploaded = new Map<string, string>();
    await runJob(r.jobId, (input, job) => processRecording(input, job, deps(sample, uploaded)));
    const a = await assetRow(r.asset.id);
    expect(a.meta).toMatchObject({ ready: true, webm: `${r.ws}/${r.sha}.webm`, poster: `${r.ws}/${r.sha}.poster.jpg`, width: 360, height: 780 });
    expect(a.meta!.duration).toBeGreaterThan(2.5);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", uploaded.get(`${r.ws}/${r.sha}.webm`)!]).toString());
    expect(probe.streams[0]).toMatchObject({ codec_name: "vp9", width: 360, height: 780 });
    expect(probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio")).toBe(false);
    expect(existsSync(uploaded.get(`${r.ws}/${r.sha}.poster.jpg`)!)).toBe(true);
  }, 60_000);

  it("a corrupt file ends with ready: false and an error, not a stuck job", async () => {
    const r = await recordingJob();
    const bad = join(dir, "bad.mp4");
    writeFileSync(bad, "this is not a video");
    await runJob(r.jobId, (input, job) => processRecording(input, job, deps(bad, new Map())), markRecordingFailed);
    expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, r.jobId)))[0]).toMatchObject({ status: "failed" });
    expect((await assetRow(r.asset.id)).meta).toMatchObject({ ready: false, error: "recording_unreadable" });
  }, 60_000);
});
