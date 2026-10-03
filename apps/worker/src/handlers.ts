import { createClient } from "@supabase/supabase-js";
import { PRICES, type JobType } from "@chitrapx/db";
import { cleanupFailedDesign, runAiCopy, runAiDesign, runAiTranslate, type AiDeps } from "./ai/jobs.ts";
import { anthropicModel } from "./ai/model.ts";
import { runBundle, type BundleDeps } from "./bundle.ts";
import { runExport } from "./export.ts";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { markRecordingFailed, processRecording, type RecordingDeps } from "./recording.ts";
import { runVideo } from "./video.ts";
import { FatalJobError, type FailureCleanup, type JobHandler } from "./runJob.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let deps: AiDeps | null = null;
/** Built on first AI job, so the worker still runs exports without an Anthropic key. */
function aiDeps(): AiDeps {
  if (deps) return deps;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new FatalJobError("ai_not_configured");
  const uploads = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from("uploads");
  deps = {
    model: anthropicModel(),
    async loadAsset(workspaceId, sha256) {
      const { data, error } = await uploads.download(`${workspaceId}/${sha256}`);
      if (error) throw new FatalJobError(`asset_missing:${sha256.slice(0, 12)}`);
      return Buffer.from(await data.arrayBuffer());
    },
  };
  return deps;
}

const uploadsBucket = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from("uploads");

/** Recordings can be 500 MB: streamed to disk, never buffered. */
const recordingDeps: RecordingDeps = {
  async download(workspaceId, sha256, dest) {
    const { data, error } = await uploadsBucket().createSignedUrl(`${workspaceId}/${sha256}`, 600);
    if (error) throw new FatalJobError("asset_missing");
    const res = await fetch(data.signedUrl);
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(dest));
  },
  async upload(path, file, contentType) {
    const { error } = await uploadsBucket().upload(path, await readFile(file), { contentType, upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
  },
};

const storageApi = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage;

export const bundleDeps: BundleDeps = {
  async download(path) {
    const { data, error } = await storageApi().from("uploads").download(path);
    if (error) throw new FatalJobError(`asset_missing:${path.split("/").pop()!.slice(0, 12)}`);
    return Buffer.from(await data.arrayBuffer());
  },
  async upload(path, bytes, contentType, bucket) {
    const { error } = await storageApi().from(bucket).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
  },
  async remove(path) { await storageApi().from("uploads").remove([path]); },
};

export const handlers: Record<JobType, JobHandler> = {
  /** Proves queue, worker and credits end to end. `{ fail: true }` exercises the refund path. */
  noop: async (input) => {
    await sleep(1000);
    if ((input as { fail?: boolean } | null)?.fail) throw new FatalJobError("noop failed on request");
    return { actual: PRICES.noop, output: { ok: true } };
  },
  export: runExport,
  export_single: (input, job) => runExport(input, job, "single"),
  project_bundle: (input, job) => runBundle(input, job, bundleDeps),
  // Implemented in Task 10; nothing enqueues it before then.
  project_import: async () => { throw new FatalJobError("not_available"); },
  video: runVideo,
  process_recording: (input, job) => processRecording(input, job, recordingDeps),
  ai_design: (input, job) => runAiDesign(input, job, aiDeps()),
  ai_translate: (input, job) => runAiTranslate(input, job, aiDeps()),
  ai_copy: (input, job) => runAiCopy(input, job, aiDeps()),
};

/** What to undo when a job fails for good. */
export const cleanups: Partial<Record<JobType, FailureCleanup>> = { ai_design: cleanupFailedDesign, process_recording: markRecordingFailed };
