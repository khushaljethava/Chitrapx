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
    expect(await jobRow(jobId)).toMatchObject({ status: "queued", attempts: 1 });
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

  it("overlapping deliveries: the second never runs while the first is live, and the job ends once", async () => {
    const { ws, jobId } = await reservedJob();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = runJob(jobId, async () => { await gate; return { actual: 1 }; });
    await new Promise((r) => setTimeout(r, 50));
    let secondRan = false;
    await runJob(jobId, async () => { secondRan = true; throw new Error("overloaded"); });
    release();
    await slow;
    expect(secondRan).toBe(false);
    const finals = await db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, jobId));
    expect(finals.filter((r) => r.reason === "settle" || r.reason === "refund")).toHaveLength(1);
    expect(await jobRow(jobId)).toMatchObject({ status: "done" });
    expect(await balance(db, ws)).toBe(9);
  });

});

describe("review fixes", () => {
  it("a transient failure puts the job back in the queue; a fresh running job is never claimed twice", async () => {
    const { jobId } = await reservedJob();
    await expect(runJob(jobId, async () => { throw new Error("overloaded"); })).rejects.toThrow();
    expect(await jobRow(jobId)).toMatchObject({ status: "queued", attempts: 1 });
    await db.update(schema.jobs).set({ status: "running", startedAt: new Date() }).where(eq(schema.jobs.id, jobId));
    let ran = false;
    await runJob(jobId, async () => { ran = true; return { actual: 1 }; });
    expect(ran).toBe(false);
  });

  it("a running job abandoned past its expiry can be claimed again", async () => {
    const { jobId } = await reservedJob();
    await db.update(schema.jobs).set({ status: "running", startedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(schema.jobs.id, jobId));
    await runJob(jobId, async () => ({ actual: 1 }));
    expect(await jobRow(jobId)).toMatchObject({ status: "done" });
  });

  it("validation errors are deterministic: fail at once and refund", async () => {
    const { ws, jobId } = await reservedJob();
    const { z } = await import("zod");
    await runJob(jobId, async () => { z.object({ a: z.string() }).parse({}); return { actual: 1 }; });
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await balance(db, ws)).toBe(10);
  });

  it("runs the failure cleanup inside the refund transaction", async () => {
    const { jobId } = await reservedJob();
    let cleaned: string | null = null;
    await runJob(jobId, async () => { throw new FatalJobError("x"); }, async (_tx, job) => { cleaned = job.id; });
    expect(cleaned).toBe(jobId);
  });
});

describe("sweepAbandonedJobs", () => {
  it("fails and refunds jobs left running long past expiry, and leaves fresh ones", async () => {
    const { sweepAbandonedJobs } = await import("../src/runJob.ts");
    const old = await reservedJob();
    const fresh = await reservedJob();
    await db.update(schema.jobs).set({ status: "running", startedAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(schema.jobs.id, old.jobId));
    await db.update(schema.jobs).set({ status: "running", startedAt: new Date() }).where(eq(schema.jobs.id, fresh.jobId));
    await sweepAbandonedJobs();
    expect(await jobRow(old.jobId)).toMatchObject({ status: "failed", error: "abandoned" });
    expect(await balance(db, old.ws)).toBe(10);
    expect((await jobRow(fresh.jobId)).status).toBe("running");
  });
});
