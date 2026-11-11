import "server-only";
import { and, count, desc, eq, gt, ilike, inArray, or, sql, sum } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { db, lockWorkspace, schema, withTx } from "@chitrapx/db";
import { isStaffEmail } from "./community.ts";
import { currentUser } from "./context.ts";
import { notFound } from "./http.ts";

/** The signed-in admin's email (ADMIN_EMAILS), or a 404 for everyone else, so the panel's existence is not revealed. */
export async function requireAdmin(): Promise<string> {
  const email = (await currentUser())?.email;
  if (!email || !isStaffEmail(email, process.env.ADMIN_EMAILS)) throw notFound();
  return email;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

export async function adminStats() {
  const [[users], [users7], [users30], [workspaces], paid, subs, jobs] = await Promise.all([
    db.select({ n: count() }).from(authUsers),
    db.select({ n: count() }).from(authUsers).where(gt(authUsers.createdAt, daysAgo(7))),
    db.select({ n: count() }).from(authUsers).where(gt(authUsers.createdAt, daysAgo(30))),
    db.select({ n: count() }).from(schema.workspaces),
    db.select({ currency: schema.payments.currency, n: count(), total: sum(schema.payments.amount).mapWith(Number) })
      .from(schema.payments).where(eq(schema.payments.status, "paid")).groupBy(schema.payments.currency),
    db.select({ plan: schema.subscriptions.plan, n: count() }).from(schema.subscriptions)
      .where(inArray(schema.subscriptions.status, ["active", "cancelling"])).groupBy(schema.subscriptions.plan),
    db.select({ status: schema.jobs.status, n: count() }).from(schema.jobs)
      .where(gt(schema.jobs.createdAt, daysAgo(1))).groupBy(schema.jobs.status),
  ]);
  return {
    users: users!.n, users7: users7!.n, users30: users30!.n, workspaces: workspaces!.n,
    payments: paid.reduce((n, p) => n + p.n, 0),
    revenue: paid.map((p) => ({ currency: p.currency, amount: p.total ?? 0 })),
    subscriptions: Object.fromEntries(subs.map((s) => [s.plan, s.n])) as Partial<Record<"pro" | "studio", number>>,
    jobs24h: Object.fromEntries(jobs.map((j) => [j.status, j.n])) as Partial<Record<"queued" | "running" | "done" | "failed", number>>,
  };
}

/** The owner's email for each workspace (one owner per workspace). */
const owner = () => db.select({ workspaceId: schema.memberships.workspaceId, email: authUsers.email }).from(schema.memberships)
  .innerJoin(authUsers, eq(authUsers.id, schema.memberships.userId)).where(eq(schema.memberships.role, "owner")).as("owner");

export async function recentPayments(limit = 20) {
  const o = owner();
  return db.select({
    id: schema.payments.id, workspace: schema.workspaces.name, email: o.email, pack: schema.payments.pack, credits: schema.payments.credits,
    amount: schema.payments.amount, currency: schema.payments.currency, paidAt: schema.payments.paidAt,
  }).from(schema.payments)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.payments.workspaceId))
    .leftJoin(o, eq(o.workspaceId, schema.payments.workspaceId))
    .where(eq(schema.payments.status, "paid")).orderBy(desc(schema.payments.paidAt)).limit(limit);
}

/** Workspaces with owner email, plan and credit balance; `q` matches the owner's email or the workspace name. */
export async function adminWorkspaces(q = "", limit = 50) {
  const o = owner();
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.select({
    id: schema.workspaces.id, name: schema.workspaces.name, plan: schema.workspaces.plan, email: o.email, createdAt: schema.workspaces.createdAt,
    credits: sql<number>`(select coalesce(sum(delta), 0)::int from credit_ledger where workspace_id = ${schema.workspaces.id})`,
  }).from(schema.workspaces)
    .leftJoin(o, eq(o.workspaceId, schema.workspaces.id))
    .where(q ? or(ilike(o.email, like), ilike(schema.workspaces.name, like)) : undefined)
    .orderBy(desc(schema.workspaces.createdAt)).limit(limit);
}

const creditsInput = z.object({
  workspaceId: z.uuid(), delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, "Must not be 0"), note: z.string().trim().min(1).max(200),
});

/** Grants (or takes back) credits; the ledger row records which admin did it and why. */
export async function adjustCredits(adminEmail: string, raw: unknown) {
  const { workspaceId, delta, note } = creditsInput.parse(raw);
  await withTx(async ({ db: tx }) => {
    const [ws] = await tx.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    if (!ws) throw notFound();
    await lockWorkspace(tx, workspaceId);
    await tx.insert(schema.creditLedger).values({ workspaceId, delta, reason: "adjust", note: `admin:${adminEmail}: ${note}` });
  });
  return { ok: true };
}

const planInput = z.object({ workspaceId: z.uuid(), plan: z.enum(["free", "pro", "studio"]) });

/**
 * Sets a workspace's plan by hand (comped accounts, support fixes).
 * ponytail: logged to the server log, no audit table. A paying workspace's next subscription webhook sets its plan again.
 */
export async function setPlan(adminEmail: string, raw: unknown) {
  const { workspaceId, plan } = planInput.parse(raw);
  const [row] = await db.update(schema.workspaces).set({ plan }).where(eq(schema.workspaces.id, workspaceId)).returning({ id: schema.workspaces.id });
  if (!row) throw notFound();
  console.info(`admin: ${adminEmail} set workspace ${workspaceId} to ${plan}`);
  return { ok: true };
}

/** Failed jobs from the last 7 days, newest first, for spotting AI or export outages. */
export async function failedJobs(limit = 10) {
  return db.select({ id: schema.jobs.id, type: schema.jobs.type, error: schema.jobs.error, createdAt: schema.jobs.createdAt })
    .from(schema.jobs).where(and(eq(schema.jobs.status, "failed"), gt(schema.jobs.createdAt, daysAgo(7))))
    .orderBy(desc(schema.jobs.createdAt)).limit(limit);
}
