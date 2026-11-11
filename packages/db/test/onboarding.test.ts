import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, pool, schema } from "../src/client.ts";
import { balance } from "../src/credits.ts";
import { grantMonthlyCredits, isGrantDue } from "../src/grants.ts";
import { ensureWorkspace } from "../src/onboarding.ts";
import { PLANS } from "../src/plans.ts";
import { createUser, ledgerSum } from "./helpers.ts";

describe("ensureWorkspace", () => {
  it("creates workspace, owner membership, profile and the free grant once", async () => {
    const user = await createUser();
    const first = await ensureWorkspace({ ...user, name: "Asha" });
    const again = await ensureWorkspace({ ...user, name: "Asha" });

    expect(first.created).toBe(true);
    expect(again).toEqual({ workspaceId: first.workspaceId, created: false });
    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, first.workspaceId));
    expect(ws).toMatchObject({ name: "Asha's workspace", plan: "free" });
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id));
    expect(m?.role).toBe("owner");
    expect(await balance(db, first.workspaceId)).toBe(PLANS.free.monthlyCredits);
  });

  it("falls back to the email local part for the name", async () => {
    const user = await createUser();
    const { workspaceId } = await ensureWorkspace(user);
    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    expect(ws!.name).toBe(`${user.email.split("@")[0]}'s workspace`);
  });

  it("is safe under a double-clicked magic link", async () => {
    const user = await createUser();
    const [a, b] = await Promise.all([ensureWorkspace(user), ensureWorkspace(user)]);
    expect(a.workspaceId).toBe(b.workspaceId);
    const n = await db.execute<{ n: number }>(sql`select count(*)::int as n from memberships where user_id = ${user.id}`);
    expect(n.rows[0]!.n).toBe(1);
    expect(await balance(db, a.workspaceId)).toBe(PLANS.free.monthlyCredits);
  });
});

describe("isGrantDue", () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  it("clamps the 31st to the last day of short months", () => {
    expect(isGrantDue(d("2026-01-31"), d("2026-02-28"))).toBe(true);
    expect(isGrantDue(d("2026-01-31"), d("2026-02-27"))).toBe(false);
  });
  it("is due on and after the creation day of month", () => {
    expect(isGrantDue(d("2026-01-15"), d("2026-03-15"))).toBe(true);
    expect(isGrantDue(d("2026-01-15"), d("2026-03-20"))).toBe(true);
    expect(isGrantDue(d("2026-01-15"), d("2026-03-14"))).toBe(false);
  });
  it("is never due before the workspace existed", () => {
    expect(isGrantDue(d("2026-05-01"), d("2026-03-20"))).toBe(false);
  });
});

describe("grantMonthlyCredits", () => {
  async function workspaceCreated(createdAt: string, credits: number) {
    const user = await createUser();
    const { workspaceId } = await ensureWorkspace(user);
    await pool.query("update workspaces set created_at = $1 where id = $2", [createdAt, workspaceId]);
    await pool.query("update credit_ledger set note = '2026-01', delta = $1 where workspace_id = $2", [credits, workspaceId]);
    return workspaceId;
  }

  it("tops up to the plan allowance once per month", async () => {
    const ws = await workspaceCreated("2026-01-15T00:00:00Z", 2);
    await grantMonthlyCredits(new Date("2026-03-15T03:00:00Z"));
    expect(await ledgerSum(db, ws)).toBe(PLANS.free.monthlyCredits);
    await grantMonthlyCredits(new Date("2026-03-16T03:00:00Z"));
    expect(await ledgerSum(db, ws)).toBe(PLANS.free.monthlyCredits);
  });

  it("writes a zero marker when the balance already exceeds the allowance", async () => {
    const ws = await workspaceCreated("2026-01-15T00:00:00Z", 60);
    await grantMonthlyCredits(new Date("2026-03-15T03:00:00Z"));
    expect(await ledgerSum(db, ws)).toBe(60);
    const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from credit_ledger where workspace_id = ${ws} and note = '2026-03' and delta = 0`);
    expect(rows.rows[0]!.n).toBe(1);
  });
});
