import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { balance, db, lockWorkspace, PLANS, schema, withTx, type Db, type Plan } from "@chitrapx/db";
import type { Ctx } from "./context.ts";
import { badRequest, HttpError } from "./http.ts";

/** Launch values, business-tunable: credits and price in the currency's smallest unit (paise for INR). */
export const CREDIT_PACKS = {
  small: { credits: 100, amount: 49900 },
  medium: { credits: 500, amount: 199900 },
  large: { credits: 2000, amount: 699900 },
} as const;
export type PackId = keyof typeof CREDIT_PACKS;
const MAX_OPEN_ORDERS_PER_HOUR = 20;
export const PAID_PLANS = ["pro", "studio"] as const;
type PaidPlan = (typeof PAID_PLANS)[number];

export const currency = () => process.env.RAZORPAY_CURRENCY ?? "INR";
const keyId = () => process.env.RAZORPAY_KEY_ID ?? "";
const secret = (name: "RAZORPAY_KEY_SECRET" | "RAZORPAY_WEBHOOK_SECRET") => {
  const v = process.env[name];
  if (!v) throw new HttpError(503, "billing_unavailable", "Payments are not set up yet");
  return v;
};
/** Razorpay Plans (which hold the price) are created in the Razorpay dashboard; we keep only their ids. */
const planId = (plan: PaidPlan) => {
  const v = process.env[plan === "pro" ? "RAZORPAY_PLAN_PRO" : "RAZORPAY_PLAN_STUDIO"];
  if (!v) throw new HttpError(503, "billing_unavailable", "This plan is not on sale yet");
  return v;
};
export const billingConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

async function razorpay<T>(path: string, body: unknown): Promise<T> {
  const auth = Buffer.from(`${keyId()}:${secret("RAZORPAY_KEY_SECRET")}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error(`razorpay ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    throw new HttpError(502, "payment_provider_error", "The payment provider did not respond; try again");
  }
  return res.json() as Promise<T>;
}

/** Constant-time HMAC-SHA256 hex check. */
export function signatureValid(payload: string, signature: unknown, key: string): boolean {
  if (typeof signature !== "string") return false;
  const expected = Buffer.from(createHmac("sha256", key).update(payload).digest("hex"));
  const got = Buffer.from(signature);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// ---- Credit packs --------------------------------------------------------------------------

export async function createOrder(ctx: Ctx, raw: unknown) {
  const { pack } = z.object({ pack: z.enum(Object.keys(CREDIT_PACKS) as [PackId, ...PackId[]]) }).parse(raw);
  const { credits, amount } = CREDIT_PACKS[pack];
  const [{ open }] = (await db.select({ open: count() }).from(schema.payments).where(and(
    eq(schema.payments.workspaceId, ctx.workspaceId), eq(schema.payments.status, "created"), gt(schema.payments.createdAt, new Date(Date.now() - 3600_000)),
  ))) as [{ open: number }];
  if (open >= MAX_OPEN_ORDERS_PER_HOUR) throw new HttpError(429, "too_many_orders", "Too many unpaid orders; try again later");
  // Our row exists before Razorpay's order, so a paid order can never be unknown to us.
  const [row] = await db.insert(schema.payments).values({
    workspaceId: ctx.workspaceId, razorpayOrderId: `pending:${randomUUID()}`, pack, credits, amount, currency: currency(),
  }).returning({ id: schema.payments.id });
  let order: { id: string };
  try {
    order = await razorpay<{ id: string }>("/orders", {
      amount, currency: currency(), receipt: row!.id.slice(0, 40), notes: { workspaceId: ctx.workspaceId, pack, paymentRow: row!.id },
    });
  } catch (err) {
    await db.update(schema.payments).set({ status: "failed" }).where(eq(schema.payments.id, row!.id));
    throw err;
  }
  await db.update(schema.payments).set({ razorpayOrderId: order.id }).where(eq(schema.payments.id, row!.id));
  return { orderId: order.id, amount, currency: currency(), keyId: keyId(), credits };
}

/**
 * Adds the pack's credits exactly once for a paid order. Safe to call from checkout and from
 * every webhook delivery. Returns false when nothing changed (unknown order or already paid).
 */
export async function fulfilOrder(orderId: string, paymentId: string, paid?: { amount: number; currency: string }): Promise<boolean> {
  return withTx(async ({ db: tx }) => {
    const [row] = await tx.select().from(schema.payments).where(eq(schema.payments.razorpayOrderId, orderId));
    if (!row) return false;
    if (paid && (paid.amount !== row.amount || paid.currency !== row.currency)) {
      console.error(`billing: order ${orderId} paid ${paid.amount} ${paid.currency}, expected ${row.amount} ${row.currency}`);
      return false;
    }
    await lockWorkspace(tx, row.workspaceId);
    const [flipped] = await tx.update(schema.payments).set({ status: "paid", razorpayPaymentId: paymentId, paidAt: new Date() })
      .where(and(eq(schema.payments.id, row.id), eq(schema.payments.status, "created"))).returning({ id: schema.payments.id });
    if (!flipped) return false;
    await tx.insert(schema.creditLedger).values({ workspaceId: row.workspaceId, delta: row.credits, reason: "purchase", note: `pay:${paymentId}` });
    return true;
  });
}

/** Checkout's success handler: only a valid signature over our own order adds credits. */
export async function verifyOrderPayment(ctx: Ctx, raw: unknown) {
  const v = z.object({ razorpay_order_id: z.string().max(64), razorpay_payment_id: z.string().max(64), razorpay_signature: z.string().max(128) }).parse(raw);
  if (!signatureValid(`${v.razorpay_order_id}|${v.razorpay_payment_id}`, v.razorpay_signature, secret("RAZORPAY_KEY_SECRET"))) throw badRequest("invalid_signature");
  const [row] = await db.select({ ws: schema.payments.workspaceId }).from(schema.payments).where(eq(schema.payments.razorpayOrderId, v.razorpay_order_id));
  if (row?.ws !== ctx.workspaceId) throw badRequest("unknown_order");
  await fulfilOrder(v.razorpay_order_id, v.razorpay_payment_id);
  return { ok: true };
}

// ---- Subscriptions -------------------------------------------------------------------------

const LIVE = ["active", "cancelling"] as const;

export async function createSubscription(ctx: Ctx, raw: unknown) {
  const { plan } = z.object({ plan: z.enum(PAID_PLANS) }).parse(raw);
  // Serialized per workspace: two tabs can never both hold a payable subscription.
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const mine = await tx.select().from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.workspaceId, ctx.workspaceId), inArray(schema.subscriptions.status, ["created", ...LIVE])));
    if (mine.some((s) => s.status !== "created")) throw new HttpError(409, "already_subscribed", "Cancel the current plan before choosing another");
    // Unpaid checkouts from earlier attempts are cancelled so they can no longer be paid.
    for (const old of mine) {
      await razorpay(`/subscriptions/${encodeURIComponent(old.razorpaySubscriptionId)}/cancel`, { cancel_at_cycle_end: 0 })
        .catch(() => console.error(`billing: could not cancel unpaid subscription ${old.razorpaySubscriptionId}`));
      await tx.update(schema.subscriptions).set({ status: "ended" }).where(eq(schema.subscriptions.id, old.id));
    }
    // total_count is required by Razorpay; 10 years of monthly cycles.
    const sub = await razorpay<{ id: string }>("/subscriptions", {
      plan_id: planId(plan), total_count: 120, customer_notify: 1, notes: { workspaceId: ctx.workspaceId, plan },
    });
    await tx.insert(schema.subscriptions).values({ workspaceId: ctx.workspaceId, razorpaySubscriptionId: sub.id, plan });
    return { subscriptionId: sub.id, keyId: keyId() };
  });
}

/**
 * Puts the workspace on the subscription's plan and tops credits up to the plan's allowance,
 * once per charged payment. Idempotent across checkout and webhook deliveries.
 */
export async function activateSubscription(subscriptionId: string, paymentId: string | null, currentEnd?: number | null): Promise<boolean> {
  return withTx(async ({ db: tx }) => {
    const [found] = await tx.select({ ws: schema.subscriptions.workspaceId }).from(schema.subscriptions)
      .where(eq(schema.subscriptions.razorpaySubscriptionId, subscriptionId));
    if (!found) return false;
    await lockWorkspace(tx, found.ws);
    const [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.razorpaySubscriptionId, subscriptionId));
    if (!sub) return false;
    if (sub.status === "ended") {
      // An end processed before this charge: the money was still taken, so its credits are still due.
      if (paymentId) await grantFor(tx, sub.workspaceId, sub.plan, paymentId);
      return false;
    }
    const [other] = await tx.select({ id: schema.subscriptions.id, rz: schema.subscriptions.razorpaySubscriptionId }).from(schema.subscriptions).where(and(
      eq(schema.subscriptions.workspaceId, sub.workspaceId), inArray(schema.subscriptions.status, [...LIVE]), ne(schema.subscriptions.id, sub.id),
    ));
    if (other) {
      // A second paid subscription (should not happen: creation cancels unpaid ones). Stop it charging again.
      console.error(`billing: workspace ${sub.workspaceId} paid ${subscriptionId} while ${other.rz} is live; cancelling it, refund payment ${paymentId} manually`);
      await razorpay(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: 0 }).catch(() => {});
      await tx.update(schema.subscriptions).set({ status: "ended" }).where(eq(schema.subscriptions.id, sub.id));
      return false;
    }
    await tx.update(schema.subscriptions).set({
      status: sub.status === "cancelling" ? "cancelling" : "active",
      ...(currentEnd ? { currentEnd: new Date(currentEnd * 1000) } : {}),
    }).where(eq(schema.subscriptions.id, sub.id));
    await tx.update(schema.workspaces).set({ plan: sub.plan }).where(eq(schema.workspaces.id, sub.workspaceId));
    if (paymentId) await grantFor(tx, sub.workspaceId, sub.plan, paymentId);
    return true;
  });
}

async function grantFor(tx: Db, workspaceId: string, plan: Plan, paymentId: string) {
  const note = `pay:${paymentId}`;
  const [done] = await tx.select({ id: schema.creditLedger.id }).from(schema.creditLedger)
    .where(and(eq(schema.creditLedger.workspaceId, workspaceId), eq(schema.creditLedger.reason, "plan_grant"), eq(schema.creditLedger.note, note))).limit(1);
  if (done) return;
  const delta = Math.max(0, PLANS[plan].monthlyCredits - (await balance(tx, workspaceId)));
  await tx.insert(schema.creditLedger).values({ workspaceId, delta, reason: "plan_grant", note });
}

/** The subscription is over: back to free. Credits already granted stay. */
export async function endSubscription(subscriptionId: string): Promise<boolean> {
  return withTx(async ({ db: tx }) => {
    const [sub] = await tx.update(schema.subscriptions).set({ status: "ended" })
      .where(eq(schema.subscriptions.razorpaySubscriptionId, subscriptionId)).returning();
    if (!sub) return false;
    const [other] = await tx.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.workspaceId, sub.workspaceId), inArray(schema.subscriptions.status, [...LIVE])));
    if (!other) await tx.update(schema.workspaces).set({ plan: "free" }).where(eq(schema.workspaces.id, sub.workspaceId));
    return true;
  });
}

export async function verifySubscriptionPayment(ctx: Ctx, raw: unknown) {
  const v = z.object({ razorpay_subscription_id: z.string().max(64), razorpay_payment_id: z.string().max(64), razorpay_signature: z.string().max(128) }).parse(raw);
  if (!signatureValid(`${v.razorpay_payment_id}|${v.razorpay_subscription_id}`, v.razorpay_signature, secret("RAZORPAY_KEY_SECRET"))) throw badRequest("invalid_signature");
  const [row] = await db.select({ ws: schema.subscriptions.workspaceId }).from(schema.subscriptions)
    .where(eq(schema.subscriptions.razorpaySubscriptionId, v.razorpay_subscription_id));
  if (row?.ws !== ctx.workspaceId) throw badRequest("unknown_subscription");
  await activateSubscription(v.razorpay_subscription_id, v.razorpay_payment_id);
  return { ok: true };
}

/** Cancels at the end of the paid cycle; the plan stays until Razorpay reports the end. */
export async function cancelSubscription(ctx: Ctx) {
  const [sub] = await db.select().from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.workspaceId, ctx.workspaceId), eq(schema.subscriptions.status, "active")));
  if (!sub) throw new HttpError(409, "no_subscription");
  await razorpay(`/subscriptions/${encodeURIComponent(sub.razorpaySubscriptionId)}/cancel`, { cancel_at_cycle_end: 1 });
  // Only if still active: an end reported meanwhile must not be revived.
  await db.update(schema.subscriptions).set({ status: "cancelling" }).where(and(eq(schema.subscriptions.id, sub.id), eq(schema.subscriptions.status, "active")));
  return { ok: true };
}

// ---- Webhook -------------------------------------------------------------------------------

type Entity = Record<string, unknown>;
const entity = z.object({ entity: z.record(z.string(), z.unknown()) }).optional();
const webhookBody = z.object({ event: z.string(), payload: z.object({ payment: entity, subscription: entity }).passthrough() });
const str = (e: Entity | undefined, k: string) => (typeof e?.[k] === "string" ? (e[k] as string) : null);
const num = (e: Entity | undefined, k: string) => (typeof e?.[k] === "number" ? (e[k] as number) : null);

/** Verifies the signature over the raw body, skips repeats by event id, then applies the event. */
export async function handleWebhook(rawBody: string, signature: string | null, eventId: string | null): Promise<{ handled: boolean }> {
  if (!signatureValid(rawBody, signature, secret("RAZORPAY_WEBHOOK_SECRET"))) throw badRequest("invalid_signature");
  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { throw badRequest("invalid_json"); }
  const parsed = webhookBody.safeParse(json);
  if (!parsed.success) return { handled: false };
  const { event, payload } = parsed.data;
  const payment = payload.payment?.entity;
  const sub = payload.subscription?.entity;

  const id = eventId?.slice(0, 128);
  if (id) {
    const [fresh] = await db.insert(schema.billingEvents).values({ id }).onConflictDoNothing().returning();
    if (!fresh) return { handled: false };
  }
  try {
    await applyEvent(event, payment, sub);
  } catch (err) {
    // Forget the delivery so Razorpay's retry is applied, not skipped; every effect is idempotent.
    if (id) await db.delete(schema.billingEvents).where(eq(schema.billingEvents.id, id)).catch(() => {});
    throw err;
  }
  return { handled: true };
}

async function applyEvent(event: string, payment: Entity | undefined, sub: Entity | undefined) {
  switch (event) {
    case "payment.captured":
    case "order.paid": {
      const orderId = str(payment, "order_id"), paymentId = str(payment, "id");
      const amount = num(payment, "amount"), cur = str(payment, "currency");
      // Subscription charges also carry an order id that is not ours; fulfilOrder ignores it.
      if (orderId && paymentId && amount !== null && cur) await fulfilOrder(orderId, paymentId, { amount, currency: cur });
      break;
    }
    case "subscription.activated":
    case "subscription.charged": {
      const id = str(sub, "id");
      if (id) await activateSubscription(id, event === "subscription.charged" ? str(payment, "id") : null, num(sub, "current_end"));
      break;
    }
    case "subscription.cancelled":
    case "subscription.halted":
    case "subscription.completed": {
      const id = str(sub, "id");
      if (id) await endSubscription(id);
      break;
    }
  }
}

// ---- Page data -----------------------------------------------------------------------------

export async function billingOverview(ctx: Ctx) {
  const [subs, recent] = await Promise.all([
    db.select().from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.workspaceId, ctx.workspaceId), inArray(schema.subscriptions.status, [...LIVE]))).limit(1),
    db.select().from(schema.payments)
      .where(and(eq(schema.payments.workspaceId, ctx.workspaceId), eq(schema.payments.status, "paid"))).orderBy(desc(schema.payments.createdAt)).limit(10),
  ]);
  return { plan: ctx.plan, subscription: subs[0] ?? null, payments: recent, configured: billingConfigured(), currency: currency() };
}
