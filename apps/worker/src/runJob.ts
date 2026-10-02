import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { db, refund, schema, settle, withTx, type Db } from "@chitrapx/db";

/** Retrying cannot help (bad input, refused content): fail now and refund. */
export class FatalJobError extends Error {}

/** 1 run + pg-boss retryLimit 3. */
export const MAX_ATTEMPTS = 4;
/** Longer than the longest pg-boss expiry (exports, 30 min): a job running this long has been abandoned. */
export const ABANDONED_AFTER_MS = 35 * 60_000;

export type JobContext = { id: string; workspaceId: string; projectId: string | null };
export type JobHandler = (input: unknown, job: JobContext) => Promise<{ actual: number; output?: unknown }>;
/** Runs inside the refund transaction when a job fails for good (for example, removing what it created). */
export type FailureCleanup = (tx: Db, job: JobContext) => Promise<void>;

/** Moves a running job to its final status; true only for the one delivery that did it. */
async function finish(tx: Db, jobId: string, set: Partial<typeof schema.jobs.$inferInsert>): Promise<boolean> {
  const done = await tx.update(schema.jobs).set({ ...set, finishedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "running")))
    .returning({ id: schema.jobs.id });
  return done.length > 0;
}

/** Deterministic failures: running the job again would fail the same way (and pay for it again). */
const isFatal = (err: unknown) => err instanceof FatalJobError || err instanceof ZodError;

export async function runJob(jobId: string, handler: JobHandler, onFail?: FailureCleanup): Promise<void> {
  const stale = new Date(Date.now() - ABANDONED_AFTER_MS);
  // Claim: a queued job, or one whose previous run was abandoned. A job another delivery is
  // running right now is left alone, so a redelivery never runs paid work twice at once.
  const [job] = await db.update(schema.jobs)
    .set({ status: "running", attempts: sql`${schema.jobs.attempts} + 1`, startedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), or(eq(schema.jobs.status, "queued"), and(eq(schema.jobs.status, "running"), lt(schema.jobs.startedAt, stale)))))
    .returning();
  if (!job) return;
  const ctx: JobContext = { id: job.id, workspaceId: job.workspaceId, projectId: job.projectId };

  try {
    const result = await handler(job.input, ctx);
    await withTx(async ({ db: tx }) => {
      if (await finish(tx, jobId, { status: "done", output: result.output ?? null })) await settle(tx, jobId, result.actual);
    });
  } catch (err) {
    if (!isFatal(err) && job.attempts < MAX_ATTEMPTS) {
      // Back in the queue for pg-boss's retry; the reservation stays.
      await db.update(schema.jobs).set({ status: "queued" }).where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "running")));
      throw err;
    }
    const message = err instanceof ZodError ? `invalid_data: ${err.issues[0]?.path.join(".")} ${err.issues[0]?.message}` : err instanceof Error ? err.message : String(err);
    await withTx(async ({ db: tx }) => {
      if (await finish(tx, jobId, { status: "failed", error: message })) {
        await refund(tx, jobId);
        await onFail?.(tx, ctx);
      }
    });
  }
}

/** Fails and refunds jobs left `running` past any expiry (a worker died mid-job on its last attempt). */
export async function sweepAbandonedJobs(cleanups: Partial<Record<string, FailureCleanup>> = {}): Promise<number> {
  const stale = await db.select().from(schema.jobs)
    .where(and(inArray(schema.jobs.status, ["running"]), lt(schema.jobs.startedAt, new Date(Date.now() - ABANDONED_AFTER_MS))));
  let swept = 0;
  for (const job of stale) {
    await withTx(async ({ db: tx }) => {
      if (await finish(tx, job.id, { status: "failed", error: "abandoned" })) {
        await refund(tx, job.id);
        await cleanups[job.type]?.(tx, { id: job.id, workspaceId: job.workspaceId, projectId: job.projectId });
        swept++;
      }
    });
  }
  return swept;
}
