import { and, eq, inArray } from "drizzle-orm";
import { db, schema, withTx } from "./client.ts";
import { balance, lockWorkspace } from "./credits.ts";
import { monthKey } from "./month.ts";
import { PLANS } from "./plans.ts";

/**
 * Due on or after the workspace's creation day of month (clamped to the month's last day),
 * so a missed daily run still grants later that month.
 */
export function isGrantDue(createdAt: Date, today: Date): boolean {
  if (createdAt.getTime() > today.getTime()) return false;
  const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  return today.getUTCDate() >= Math.min(createdAt.getUTCDate(), lastDay);
}

/** Tops every due workspace up to its plan allowance, once per calendar month. Returns grants written. */
export async function grantMonthlyCredits(today = new Date()): Promise<number> {
  const month = monthKey(today);
  // ponytail: scans every workspace daily; move the due filter into SQL and batch once counts reach the thousands.
  const all = await db.select({ id: schema.workspaces.id, plan: schema.workspaces.plan, createdAt: schema.workspaces.createdAt })
    .from(schema.workspaces);
  let granted = 0;
  for (const w of all) {
    if (!isGrantDue(w.createdAt, today)) continue;
    const wrote = await withTx(async ({ db: tx }) => {
      await lockWorkspace(tx, w.id);
      const [done] = await tx.select({ id: schema.creditLedger.id }).from(schema.creditLedger).where(and(
        eq(schema.creditLedger.workspaceId, w.id), eq(schema.creditLedger.reason, "plan_grant"), eq(schema.creditLedger.note, month),
      )).limit(1);
      if (done) return false;
      // A paying workspace is topped up on each subscription charge instead (one allowance per cycle).
      const [paying] = await tx.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
        .where(and(eq(schema.subscriptions.workspaceId, w.id), inArray(schema.subscriptions.status, ["active", "cancelling"]))).limit(1);
      if (paying) return false;
      // Unused credits do not roll over: top up to the allowance, never add on top of leftovers.
      const delta = Math.max(0, PLANS[w.plan].monthlyCredits - (await balance(tx, w.id)));
      await tx.insert(schema.creditLedger).values({ workspaceId: w.id, delta, reason: "plan_grant", note: month });
      return true;
    });
    if (wrote) granted++;
  }
  return granted;
}
