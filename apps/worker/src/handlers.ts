import { ObjectMissingError } from "@chitrapx/storage";
import { PRICES, type JobType } from "@chitrapx/db";
import { cleanupFailedDesign, runAiChips, runAiCopy, runAiReference, runAiDesign, runAiTranslate, type AiDeps } from "./ai/jobs.ts";
import { anthropicModel } from "./ai/model.ts";
import { cleanupFailedImport, runBundle, runImport, type BundleDeps } from "./bundle.ts";
import { runExport } from "./export.ts";
import { runAppIcons } from "./icons/index.ts";
import { runLogo } from "./icons/logo.ts";
import { runMockup } from "./mockup.ts";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { markRecordingFailed, processRecording, type RecordingDeps } from "./recording.ts";
import { runVideo } from "./video.ts";
import { storage } from "./storage.ts";
import { FatalJobError, type FailureCleanup, type JobHandler } from "./runJob.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let deps: AiDeps | null = null;
/** Built on first AI job, so the worker still runs exports without an Anthropic key. */
function aiDeps(): AiDeps {
  if (deps) return deps;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new FatalJobError("ai_not_configured");
  deps = {
    model: anthropicModel(),
    async loadAsset(workspaceId, sha256) {
      try { return await storage().download(`${workspaceId}/${sha256}`); }
      catch (err) { if (err instanceof ObjectMissingError) throw new FatalJobError(`asset_missing:${sha256.slice(0, 12)}`); throw err; }
    },
  };
  return deps;
}

/** Recordings can be 500 MB: streamed to disk, never buffered. */
const recordingDeps: RecordingDeps = {
  async download(workspaceId, sha256, dest) {
    const body = await storage().downloadStream(`${workspaceId}/${sha256}`).catch((err) => {
      throw err instanceof ObjectMissingError ? new FatalJobError("asset_missing") : err;
    });
    await pipeline(Readable.fromWeb(body as unknown as WebReadableStream), createWriteStream(dest));
  },
  async upload(path, file, contentType) {
    await storage().put(path, await readFile(file), contentType);
  },
};

export const bundleDeps: BundleDeps = {
  async download(path) {
    try { return await storage().download(path); }
    catch (err) {
      // Only a missing object is permanent; other storage errors may clear on retry.
      if (err instanceof ObjectMissingError) throw new FatalJobError(`asset_missing:${path.split("/").pop()!.slice(0, 12)}`);
      throw err;
    }
  },
  async upload(path, bytes, contentType, bucket) { await storage().put(path, bytes, contentType, bucket); },
  async remove(path) { await storage().remove(path); },
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
  project_import: (input, job) => runImport(input, job, bundleDeps),
  video: runVideo,
  process_recording: (input, job) => processRecording(input, job, recordingDeps),
  ai_design: (input, job) => runAiDesign(input, job, aiDeps()),
  ai_translate: (input, job) => runAiTranslate(input, job, aiDeps()),
  ai_copy: (input, job) => runAiCopy(input, job, aiDeps()),
  ai_chips: (input, job) => runAiChips(input, job, aiDeps()),
  ai_reference: (input, job) => runAiReference(input, job, aiDeps()),
  app_icons: (input, job) => runAppIcons(input, job, bundleDeps),
  logo_starter: (input, job) => runLogo(input, job, bundleDeps),
  collage: async () => { throw new FatalJobError("not_implemented"); },
  mockup: (input, job) => runMockup(input, job, bundleDeps),
};

/** What to undo when a job fails for good. */
export const cleanups: Partial<Record<JobType, FailureCleanup>> = {
  ai_design: cleanupFailedDesign, process_recording: markRecordingFailed,
  project_import: (tx, job) => cleanupFailedImport(tx, job, bundleDeps),
};
