import { and, eq, inArray, sql } from "drizzle-orm";
import { db, refund, schema, settle, withTx, type Db } from "@chitrapx/db";

/** Retrying cannot help (bad input, refused content): fail now and refund. */
export class FatalJobError extends Error {}

/** 1 run + pg-boss retryLimit 3. */
export const MAX_ATTEMPTS = 4;

export type JobContext = { id: string; workspaceId: string; projectId: string | null };
export type JobHandler = (input: unknown, job: JobContext) => Promise<{ actual: number; output?: unknown }>;

/** Moves a running job to its final status; true only for the one delivery that did it. */
async function finish(tx: Db, jobId: string, set: Partial<typeof schema.jobs.$inferInsert>): Promise<boolean> {
  const done = await tx.update(schema.jobs).set({ ...set, finishedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "running")))
    .returning({ id: schema.jobs.id });
  return done.length > 0;
}

// ponytail: if the process dies during the final attempt, the job stays `running` with its credits
// reserved; add a sweeper that fails and refunds jobs stuck past pg-boss expiry before real AI jobs ship.
export async function runJob(jobId: string, handler: JobHandler): Promise<void> {
  const [job] = await db.update(schema.jobs)
    .set({ status: "running", attempts: sql`${schema.jobs.attempts} + 1`, startedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), inArray(schema.jobs.status, ["queued", "running"])))
    .returning();
  if (!job) return; // already done or failed: a redelivery

  try {
    const result = await handler(job.input, { id: job.id, workspaceId: job.workspaceId, projectId: job.projectId });
    await withTx(async ({ db: tx }) => {
      if (await finish(tx, jobId, { status: "done", output: result.output ?? null })) await settle(tx, jobId, result.actual);
    });
  } catch (err) {
    if (!(err instanceof FatalJobError) && job.attempts < MAX_ATTEMPTS) throw err;
    await withTx(async ({ db: tx }) => {
      if (await finish(tx, jobId, { status: "failed", error: err instanceof Error ? err.message : String(err) })) await refund(tx, jobId);
    });
  }
}
