import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema, withTx } from "../src/client.ts";
import { balance, InsufficientCreditsError, refund, reserveAndEnqueue, settle } from "../src/credits.ts";
import { createUser, makeWorkspace } from "./helpers.ts";

let boss: PgBoss;
beforeAll(async () => {
  boss = new PgBoss(process.env.DATABASE_URL!);
  await boss.start();
  await boss.createQueue("noop");
});
afterAll(async () => { await boss.stop({ graceful: false }); });

async function workspaceWith(credits: number): Promise<string> {
  const ws = await makeWorkspace((await createUser()).id);
  if (credits) await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: credits, reason: "adjust" });
  return ws;
}
const reserve = (ws: string, input: unknown = {}) =>
  withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ws, type: "noop", input }));
const jobCount = async (ws: string) =>
  (await db.execute<{ n: number }>(sql`select count(*)::int as n from jobs where workspace_id = ${ws}`)).rows[0]!.n;

describe("credits", () => {
  it("reserve lowers the balance, refund restores it once", async () => {
    const ws = await workspaceWith(50);
    expect(await balance(db, ws)).toBe(50);
    const { jobId } = await reserve(ws);
    expect(await balance(db, ws)).toBe(49);
    await refund(db, jobId);
    await refund(db, jobId);
    expect(await balance(db, ws)).toBe(50);
  });

  it("enqueues a pg-boss job carrying our job id", async () => {
    const ws = await workspaceWith(5);
    const { jobId } = await reserve(ws, { hello: 1 });
    const [job] = await db.select().from(schema.jobs).where(sql`id = ${jobId}`);
    expect(job).toMatchObject({ status: "queued", creditsReserved: 1, input: { hello: 1 } });
    const q = await pool.query("select count(*)::int as n from pgboss.job where name = 'noop' and data->>'jobId' = $1", [jobId]);
    expect(q.rows[0].n).toBe(1);
  });

  it("settle charges the difference once", async () => {
    const ws = await workspaceWith(10);
    const { jobId } = await reserve(ws);
    await settle(db, jobId, 1);
    await settle(db, jobId, 1);
    expect(await balance(db, ws)).toBe(9);
  });

  it("rejects at balance 0 and leaves no job row", async () => {
    const ws = await workspaceWith(0);
    await expect(reserve(ws)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await jobCount(ws)).toBe(0);
    expect(await balance(db, ws)).toBe(0);
  });

  it("two concurrent reserves on balance 1 create exactly one job", async () => {
    const ws = await workspaceWith(1);
    const results = await Promise.allSettled([reserve(ws), reserve(ws)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await jobCount(ws)).toBe(1);
    expect(await balance(db, ws)).toBe(0);
  });
});
