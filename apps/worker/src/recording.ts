import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db } from "@chitrapx/db";
import { FatalJobError, type FailureCleanup, type JobContext } from "./runJob.ts";

const exec = promisify(execFile);
/** Every ffmpeg/ffprobe call is killed well before the job expires, so a pathological file never holds a worker slot. */
const run = (cmd: string, args: string[], opts: { maxBuffer?: number } = {}) =>
  exec(cmd, args, { ...opts, timeout: 10 * 60_000, killSignal: "SIGKILL" });
const FFMPEG = () => process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = () => process.env.FFPROBE_PATH ?? "ffprobe";
/** App Previews are 30 seconds at most; anything past a minute is never shown. */
const MAX_SECONDS = 60;
const MAX_EDGE = 1080;

export type RecordingDeps = {
  /** Streams the original upload into `dest`. */
  download: (workspaceId: string, sha256: string, dest: string) => Promise<void>;
  upload: (path: string, file: string, contentType: string) => Promise<void>;
};

type Probe = { duration: number; width: number; height: number };
async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]);
  const j = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
  const s = j.streams?.[0];
  if (!s?.width || !s.height) throw new Error("no video stream");
  return { width: s.width, height: s.height, duration: Number(j.format?.duration ?? 0) };
}

/**
 * Converts an uploaded screen recording into VP9 WebM (which headless Chromium and current browsers
 * play; H.264 and HEVC are not available in open-source Chromium), plus a poster and its metadata.
 */
export async function processRecording(raw: unknown, job: JobContext, deps: RecordingDeps): Promise<{ actual: number; output: unknown }> {
  const parsed = z.object({ assetId: z.uuid() }).safeParse(raw);
  if (!parsed.success) throw new FatalJobError("invalid_input");
  const [asset] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.id, parsed.data.assetId), eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.kind, "recording"),
  ));
  if (!asset) throw new FatalJobError("asset_missing");

  const work = await mkdtemp(join(tmpdir(), `rec-${job.id}-`));
  try {
    const source = join(work, "source");
    const webm = join(work, "out.webm");
    const poster = join(work, "poster.jpg");
    await deps.download(job.workspaceId, asset.sha256, source);
    try { await probe(source); } catch { throw new FatalJobError("recording_unreadable"); }

    // Long edge at most 1080 px (even sizes for the encoder), 30 fps, no audio, first minute only.
    const scale = `scale='if(gt(iw,ih),min(${MAX_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${MAX_EDGE},ih))',fps=30`;
    try {
      await run(FFMPEG(), ["-y", "-loglevel", "error", "-i", source, "-t", String(MAX_SECONDS), "-an", "-vf", scale,
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", webm], { maxBuffer: 1 << 20 });
    } catch { throw new FatalJobError("recording_unreadable"); }
    const out = await probe(webm);
    await run(FFMPEG(), ["-y", "-loglevel", "error", "-ss", String(Math.min(0.5, out.duration / 2)), "-i", webm, "-frames:v", "1", "-q:v", "3", poster]);

    const prefix = `${job.workspaceId}/${asset.sha256}`;
    await deps.upload(`${prefix}.webm`, webm, "video/webm");
    await deps.upload(`${prefix}.poster.jpg`, poster, "image/jpeg");
    const meta = { ready: true, webm: `${prefix}.webm`, poster: `${prefix}.poster.jpg`, duration: out.duration, width: out.width, height: out.height };
    // Every app's copy of this file shares the conversion.
    await db.update(schema.assets).set({ meta, width: out.width, height: out.height })
      .where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.sha256, asset.sha256), eq(schema.assets.kind, "recording")));
    return { actual: 0, output: meta };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** A recording that could not be converted says so, instead of showing "processing" forever. */
export const markRecordingFailed: FailureCleanup = async (tx: Db, job) => {
  const [row] = await tx.select({ input: schema.jobs.input, error: schema.jobs.error }).from(schema.jobs).where(eq(schema.jobs.id, job.id));
  const assetId = (row?.input as { assetId?: string } | null)?.assetId;
  if (!assetId || !z.uuid().safeParse(assetId).success) return;
  const [asset] = await tx.select({ sha256: schema.assets.sha256 }).from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.workspaceId, job.workspaceId)));
  if (!asset) return;
  await tx.update(schema.assets).set({ meta: { ready: false, error: row?.error ?? "processing_failed" } })
    .where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.sha256, asset.sha256), eq(schema.assets.kind, "recording")));
};
