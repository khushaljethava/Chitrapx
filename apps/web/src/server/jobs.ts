import { desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { db, reserveAndEnqueue, schema, withTx } from "@chitrapx/db";
import type { Ctx } from "./context.ts";

export type JobSummary = Pick<typeof schema.jobs.$inferSelect, "id" | "type" | "status" | "error" | "createdAt" | "finishedAt">;

export async function enqueueNoop(ctx: Ctx, boss: PgBoss, input: { fail: boolean }): Promise<{ jobId: string }> {
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "noop", input }));
}

export async function listJobs(ctx: Ctx, limit = 10): Promise<JobSummary[]> {
  return db.select({
    id: schema.jobs.id, type: schema.jobs.type, status: schema.jobs.status, error: schema.jobs.error,
    createdAt: schema.jobs.createdAt, finishedAt: schema.jobs.finishedAt,
  }).from(schema.jobs).where(eq(schema.jobs.workspaceId, ctx.workspaceId)).orderBy(desc(schema.jobs.createdAt)).limit(limit);
}
