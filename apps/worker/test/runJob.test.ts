import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { balance, db, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { FatalJobError, MAX_ATTEMPTS, runJob } from "../src/runJob.ts";

/** A reserved job as reserveAndEnqueue leaves it: job row + reserve row, balance 10 - 1. */
async function reservedJob(attempts = 0) {
  const ws = await makeWorkspace((await createUser()).id);
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 10, reason: "adjust" });
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, type: "noop", creditsReserved: 1, attempts, input: { a: 1 } }).returning();
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -1, reason: "reserve", jobId: job!.id });
  return { ws, jobId: job!.id };
}
const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

describe("runJob", () => {
  it("success marks done, stores output and keeps the charge", async () => {
    const { ws, jobId } = await reservedJob();
    await runJob(jobId, async (input) => ({ actual: 1, output: { echo: input } }));
    expect(await jobRow(jobId)).toMatchObject({ status: "done", attempts: 1, output: { echo: { a: 1 } } });
    expect(await balance(db, ws)).toBe(9);
  });

  it("fatal error marks failed and refunds without rethrowing", async () => {
    const { ws, jobId } = await reservedJob();
    await runJob(jobId, async () => { throw new FatalJobError("bad input"); });
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "bad input" });
    expect(await balance(db, ws)).toBe(10);
  });

  it("transient error rethrows so pg-boss retries, and does not refund", async () => {
    const { ws, jobId } = await reservedJob();
    await expect(runJob(jobId, async () => { throw new Error("overloaded"); })).rejects.toThrow("overloaded");
    expect(await jobRow(jobId)).toMatchObject({ status: "running", attempts: 1 });
    expect(await balance(db, ws)).toBe(9);
  });

  it("transient error on the last attempt fails and refunds", async () => {
    const { ws, jobId } = await reservedJob(MAX_ATTEMPTS - 1);
    await runJob(jobId, async () => { throw new Error("overloaded"); });
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(await balance(db, ws)).toBe(10);
  });

  it("a redelivered finished job is not run or charged again", async () => {
    const { ws, jobId } = await reservedJob();
    await runJob(jobId, async () => ({ actual: 1 }));
    let ran = false;
    await runJob(jobId, async () => { ran = true; return { actual: 1 }; });
    expect(ran).toBe(false);
    expect(await jobRow(jobId)).toMatchObject({ status: "done", attempts: 1 });
    expect(await balance(db, ws)).toBe(9);
  });

  it("overlapping deliveries of one job end it once, never settle plus refund", async () => {
    const { ws, jobId } = await reservedJob(MAX_ATTEMPTS - 2);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // Delivery 1 is slow and succeeds; delivery 2 (a redelivery) fails on its last attempt.
    const slow = runJob(jobId, async () => { await gate; return { actual: 1 }; });
    await new Promise((r) => setTimeout(r, 50));
    await runJob(jobId, async () => { throw new Error("overloaded"); });
    release();
    await slow;
    const finals = await db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, jobId));
    expect(finals.filter((r) => r.reason === "settle" || r.reason === "refund")).toHaveLength(1);
    expect(await jobRow(jobId)).toMatchObject({ status: "failed" });
    expect(await balance(db, ws)).toBe(10);
  });
});
