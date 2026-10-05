import { eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { schema, type Db, type Tx } from "./client.ts";
import { priceFor, type JobType } from "./pricing.ts";

export class InsufficientCreditsError extends Error {
  constructor() { super("insufficient credits"); }
}

export const RETRY = { retryLimit: 3, retryDelay: 2, retryBackoff: true } as const;
/** pg-boss redelivers a job still running after this long; must exceed the slowest healthy run. */
const EXPIRE_SECONDS: Partial<Record<JobType, number>> = { export: 1800, ai_design: 900, ai_translate: 900, ai_copy: 600, ai_chips: 600, video: 1800, process_recording: 900, export_single: 600, project_bundle: 1800, project_import: 1800 };

export async function balance(db: Db, workspaceId: string): Promise<number> {
  const r = await db.execute<{ s: number }>(
    sql`select coalesce(sum(delta), 0)::int as s from credit_ledger where workspace_id = ${workspaceId}`,
  );
  return r.rows[0]!.s;
}

/** Serializes every balance-changing check for one workspace until the transaction ends. */
export async function lockWorkspace(db: Db, workspaceId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
}

export async function reserveAndEnqueue(
  tx: Tx,
  boss: PgBoss,
  a: { workspaceId: string; projectId?: string | null; type: JobType; input: unknown },
): Promise<{ jobId: string }> {
  const cost = priceFor(a.type, a.input);
  await lockWorkspace(tx.db, a.workspaceId);
  const [job] = await tx.db.insert(schema.jobs).values({
    workspaceId: a.workspaceId, projectId: a.projectId ?? null, type: a.type, input: a.input ?? {}, creditsReserved: cost,
  }).returning({ id: schema.jobs.id });
  await tx.db.insert(schema.creditLedger).values({ workspaceId: a.workspaceId, delta: -cost, reason: "reserve", jobId: job!.id });
  if ((await balance(tx.db, a.workspaceId)) < 0) throw new InsufficientCreditsError();
  // Same connection as the transaction: the queue entry commits or rolls back with the job row.
  await boss.send(a.type, { jobId: job!.id }, {
    ...RETRY, expireInSeconds: EXPIRE_SECONDS[a.type] ?? 900,
    db: { executeSql: (text, values) => tx.client.query(text, values) },
  });
  return { jobId: job!.id };
}

async function reservedFor(db: Db, jobId: string) {
  const [job] = await db.select({ ws: schema.jobs.workspaceId, reserved: schema.jobs.creditsReserved })
    .from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new Error(`job ${jobId} not found`);
  return job;
}

/** Charges actual cost. Always writes a row (even delta 0) so a redelivered job settles once. */
export async function settle(db: Db, jobId: string, actual: number): Promise<void> {
  const job = await reservedFor(db, jobId);
  await db.insert(schema.creditLedger)
    .values({ workspaceId: job.ws, delta: job.reserved - actual, reason: "settle", jobId })
    .onConflictDoNothing();
}

export async function refund(db: Db, jobId: string): Promise<void> {
  const job = await reservedFor(db, jobId);
  await db.insert(schema.creditLedger)
    .values({ workspaceId: job.ws, delta: job.reserved, reason: "refund", jobId })
    .onConflictDoNothing();
}
