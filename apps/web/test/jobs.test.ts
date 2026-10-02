import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balance, db, InsufficientCreditsError, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import type { Ctx } from "@/server/context.ts";
import { enqueueNoop, listJobs } from "@/server/jobs.ts";

let boss: PgBoss;
beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss_test" });
  await boss.start();
  await boss.createQueue("noop");
});
afterAll(async () => { await boss.stop({ graceful: false }); });

async function ctxWith(credits: number): Promise<Ctx> {
  const user = await createUser();
  const ws = await makeWorkspace(user.id);
  if (credits) await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: credits, reason: "adjust" });
  return { userId: user.id, workspaceId: ws, plan: "free" };
}

describe("jobs", () => {
  it("enqueueNoop reserves one credit and lists the queued job", async () => {
    const ctx = await ctxWith(3);
    const { jobId } = await enqueueNoop(ctx, boss, { fail: false });
    expect(await balance(db, ctx.workspaceId)).toBe(2);
    const jobs = await listJobs(ctx);
    expect(jobs).toEqual([expect.objectContaining({ id: jobId, type: "noop", status: "queued" })]);
  });

  it("enqueueNoop at balance 0 throws and creates no job", async () => {
    const ctx = await ctxWith(0);
    await expect(enqueueNoop(ctx, boss, { fail: false })).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await listJobs(ctx)).toEqual([]);
  });

  it("listJobs never shows another workspace's jobs", async () => {
    const a = await ctxWith(3);
    const b = await ctxWith(3);
    await enqueueNoop(a, boss, { fail: false });
    expect(await listJobs(b)).toEqual([]);
  });
});
