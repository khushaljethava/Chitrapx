import { createClient } from "@supabase/supabase-js";
import { PRICES, type JobType } from "@chitrapx/db";
import { cleanupFailedDesign, runAiCopy, runAiDesign, runAiTranslate, type AiDeps } from "./ai/jobs.ts";
import { anthropicModel } from "./ai/model.ts";
import { runExport } from "./export.ts";
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

export const handlers: Record<JobType, JobHandler> = {
  /** Proves queue, worker and credits end to end. `{ fail: true }` exercises the refund path. */
  noop: async (input) => {
    await sleep(1000);
    if ((input as { fail?: boolean } | null)?.fail) throw new FatalJobError("noop failed on request");
    return { actual: PRICES.noop, output: { ok: true } };
  },
  export: runExport,
  video: runVideo,
  ai_design: (input, job) => runAiDesign(input, job, aiDeps()),
  ai_translate: (input, job) => runAiTranslate(input, job, aiDeps()),
  ai_copy: (input, job) => runAiCopy(input, job, aiDeps()),
};

/** What to undo when a job fails for good. */
export const cleanups: Partial<Record<JobType, FailureCleanup>> = { ai_design: cleanupFailedDesign };
