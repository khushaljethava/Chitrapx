import { PRICES, type JobType } from "@chitrapx/db";
import { runExport } from "./export.ts";
import { FatalJobError, type JobHandler } from "./runJob.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const handlers: Record<JobType, JobHandler> = {
  /** Proves queue, worker and credits end to end. `{ fail: true }` exercises the refund path. */
  noop: async (input) => {
    await sleep(1000);
    if ((input as { fail?: boolean } | null)?.fail) throw new FatalJobError("noop failed on request");
    return { actual: PRICES.noop, output: { ok: true } };
  },
  export: runExport,
};
