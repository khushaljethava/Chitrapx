import { and, eq, inArray, sql } from "drizzle-orm";
import { db, refund, schema, settle, withTx } from "@chitrapx/db";

/** Retrying cannot help (bad input, refused content): fail now and refund. */
export class FatalJobError extends Error {}

/** 1 run + pg-boss retryLimit 3. */
export const MAX_ATTEMPTS = 4;

export type JobHandler = (input: unknown) => Promise<{ actual: number; output?: unknown }>;

export async function runJob(jobId: string, handler: JobHandler): Promise<void> {
  const [job] = await db.update(schema.jobs)
    .set({ status: "running", attempts: sql`${schema.jobs.attempts} + 1`, startedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), inArray(schema.jobs.status, ["queued", "running"])))
    .returning();
  if (!job) return; // already done or failed: a redelivery

  try {
    const result = await handler(job.input);
    await withTx(async ({ db: tx }) => {
      await tx.update(schema.jobs).set({ status: "done", output: result.output ?? null, finishedAt: new Date() })
        .where(eq(schema.jobs.id, jobId));
      await settle(tx, jobId, result.actual);
    });
  } catch (err) {
    if (!(err instanceof FatalJobError) && job.attempts < MAX_ATTEMPTS) throw err;
    await withTx(async ({ db: tx }) => {
      await tx.update(schema.jobs)
        .set({ status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() })
        .where(eq(schema.jobs.id, jobId));
      await refund(tx, jobId);
    });
  }
}
