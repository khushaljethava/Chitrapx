import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { balance, db, grantMonthlyCredits, pool, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import type { Ctx } from "@/server/context.ts";
import {
  activateSubscription, cancelSubscription, createOrder, createSubscription, currencyFor, handleWebhook, signatureValid, verifyOrderPayment, verifySubscriptionPayment,
} from "@/server/billing.ts";

const KEY = "test_key_secret", HOOK = "test_webhook_secret";
const sign = (payload: string, key = KEY) => createHmac("sha256", key).update(payload).digest("hex");
let seq = 0;
/** The test database persists between runs; Razorpay ids are globally unique, so ours must be too. */
const RUN = Date.now().toString(36);
/** Fake Razorpay: returns a fresh id for whatever is created and records the calls. */
const calls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  Object.assign(process.env, { RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: KEY, RAZORPAY_WEBHOOK_SECRET: HOOK, RAZORPAY_PLAN_PRO_USD: "plan_pro", RAZORPAY_PLAN_STUDIO_USD: "plan_studio" });
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const prefix = url.includes("/orders") ? "order" : "sub";
    return Response.json({ id: `${prefix}_${Date.now()}_${seq++}` });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

async function ctxWith(credits: number): Promise<Ctx> {
  const ws = await makeWorkspace((await createUser()).id);
  if (credits) await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: credits, reason: "adjust" });
  return { userId: "", workspaceId: ws, plan: "free", role: "owner" };
}
const planOf = async (ws: string) => (await db.select({ plan: schema.workspaces.plan }).from(schema.workspaces).where(eq(schema.workspaces.id, ws)))[0]!.plan;
function webhook(event: string, payload: unknown, id = `evt_${RUN}_${seq++}`) {
  const body = JSON.stringify({ event, payload });
  return handleWebhook(body, sign(body, HOOK), id);
}

describe("signatures", () => {
  it("accepts only the exact HMAC", () => {
    expect(signatureValid("a|b", sign("a|b"), KEY)).toBe(true);
    expect(signatureValid("a|b", sign("a|c"), KEY)).toBe(false);
    expect(signatureValid("a|b", "short", KEY)).toBe(false);
    expect(signatureValid("a|b", undefined, KEY)).toBe(false);
  });
});

describe("country pricing", () => {
  it("picks the currency from the edge's country header, USD elsewhere", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(currencyFor(h({ "x-vercel-ip-country": "AE" }))).toBe("AED");
    expect(currencyFor(h({ "x-vercel-ip-country": "de" }))).toBe("EUR");
    expect(currencyFor(h({ "cf-ipcountry": "GB" }))).toBe("GBP");
    expect(currencyFor(h({ "x-vercel-ip-country": "KW" }))).toBe("USD");
    expect(currencyFor(h({}))).toBe("USD");
  });

  it("charges and records the order in the buyer's currency, so the webhook checks against it", async () => {
    const ctx = await ctxWith(0);
    const order = await createOrder(ctx, { pack: "small" }, "AED");
    expect(order).toMatchObject({ amount: 1900, currency: "AED" });
    expect(calls[0]!.body).toMatchObject({ amount: 1900, currency: "AED" });
    await webhook("payment.captured", { payment: { entity: { id: `pay_aed_${RUN}`, order_id: order.orderId, amount: 1900, currency: "USD" } } });
    expect(await balance(db, ctx.workspaceId)).toBe(0); // right amount, wrong currency
  });
});

describe("credit packs", () => {
  it("adds credits once, whether checkout and the webhook both report the payment", async () => {
    const ctx = await ctxWith(0);
    const order = await createOrder(ctx, { pack: "small" });
    expect(calls[0]!.body).toMatchObject({ amount: 500, currency: "USD" });
    const v = { razorpay_order_id: order.orderId, razorpay_payment_id: `pay_1_${RUN}` };
    await expect(verifyOrderPayment(ctx, { ...v, razorpay_signature: sign("x") })).rejects.toMatchObject({ code: "invalid_signature" });
    expect(await balance(db, ctx.workspaceId)).toBe(0);

    await verifyOrderPayment(ctx, { ...v, razorpay_signature: sign(`${order.orderId}|pay_1_${RUN}`) });
    await webhook("payment.captured", { payment: { entity: { id: `pay_1_${RUN}`, order_id: order.orderId, amount: 500, currency: "USD" } } });
    await verifyOrderPayment(ctx, { ...v, razorpay_signature: sign(`${order.orderId}|pay_1_${RUN}`) });
    expect(await balance(db, ctx.workspaceId)).toBe(100);
  });

  it("refuses another workspace's order and a webhook with the wrong amount", async () => {
    const a = await ctxWith(0), b = await ctxWith(0);
    const order = await createOrder(a, { pack: "medium" });
    await expect(verifyOrderPayment(b, { razorpay_order_id: order.orderId, razorpay_payment_id: `pay_2_${RUN}`, razorpay_signature: sign(`${order.orderId}|pay_2_${RUN}`) }))
      .rejects.toMatchObject({ code: "unknown_order" });
    await webhook("payment.captured", { payment: { entity: { id: `pay_2_${RUN}`, order_id: order.orderId, amount: 100, currency: "USD" } } });
    expect(await balance(db, a.workspaceId)).toBe(0);
  });

  it("rejects webhooks with a bad signature and ignores repeated event ids", async () => {
    const ctx = await ctxWith(0);
    const order = await createOrder(ctx, { pack: "small" });
    const body = JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: `pay_3_${RUN}`, order_id: order.orderId, amount: 500, currency: "USD" } } } });
    await expect(handleWebhook(body, sign(body, "wrong"), "evt_x")).rejects.toMatchObject({ code: "invalid_signature" });
    const id = `evt_dup_${seq++}_${Date.now()}`;
    expect(await handleWebhook(body, sign(body, HOOK), id)).toEqual({ handled: true });
    expect(await handleWebhook(body, sign(body, HOOK), id)).toEqual({ handled: false });
    expect(await balance(db, ctx.workspaceId)).toBe(100);
  });
});

describe("subscriptions", () => {
  it("activates the plan, tops credits up once per charge, cancels at cycle end, and returns to free when it ends", async () => {
    const ctx = await ctxWith(20);
    const { subscriptionId } = await createSubscription(ctx, { plan: "pro" });
    expect(calls[0]!.body).toMatchObject({ plan_id: "plan_pro" });

    await verifySubscriptionPayment(ctx, { razorpay_subscription_id: subscriptionId, razorpay_payment_id: `pay_s1_${RUN}`, razorpay_signature: sign(`pay_s1_${RUN}|${subscriptionId}`) });
    await webhook("subscription.charged", { subscription: { entity: { id: subscriptionId, current_end: 1_900_000_000 } }, payment: { entity: { id: `pay_s1_${RUN}` } } });
    expect(await planOf(ctx.workspaceId)).toBe("pro");
    expect(await balance(db, ctx.workspaceId)).toBe(1000);

    await expect(createSubscription(ctx, { plan: "studio" })).rejects.toMatchObject({ status: 409, code: "already_subscribed" });
    await cancelSubscription(ctx);
    expect(calls.at(-1)!.url).toContain(`/subscriptions/${subscriptionId}/cancel`);
    expect(await planOf(ctx.workspaceId)).toBe("pro");

    await webhook("subscription.cancelled", { subscription: { entity: { id: subscriptionId } } });
    expect(await planOf(ctx.workspaceId)).toBe("free");
    expect(await balance(db, ctx.workspaceId)).toBe(1000);
  });

  it("an unknown subscription in a webhook changes nothing", async () => {
    const ctx = await ctxWith(0);
    await webhook("subscription.charged", { subscription: { entity: { id: "sub_not_ours" } }, payment: { entity: { id: `pay_z_${RUN}` } } });
    expect(await planOf(ctx.workspaceId)).toBe("free");
  });
});

describe("review fixes", () => {
  const subStatus = async (rz: string) => (await db.select({ s: schema.subscriptions.status }).from(schema.subscriptions)
    .where(eq(schema.subscriptions.razorpaySubscriptionId, rz)))[0]!.s;

  it("a webhook that fails is applied when Razorpay retries it", async () => {
    const ctx = await ctxWith(0);
    const order = await createOrder(ctx, { pack: "small" });
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: `pay_r_${RUN}`, order_id: order.orderId, amount: 500, currency: "USD" } } } });
    const id = `evt_retry_${RUN}`;
    // The first delivery hits a database blip when the purchase transaction starts (pool.connect()
    // without a callback is withTx; plain queries pass a callback and are left alone).
    const orig = pool.connect.bind(pool);
    let failed = false;
    const spy = vi.spyOn(pool, "connect").mockImplementation(((cb?: unknown) => {
      if (!cb && !failed) { failed = true; return Promise.reject(new Error("db blip")); }
      return (orig as (cb?: unknown) => unknown)(cb);
    }) as never);
    await expect(handleWebhook(body, sign(body, HOOK), id)).rejects.toThrow("db blip");
    spy.mockRestore();
    expect(await balance(db, ctx.workspaceId)).toBe(0);
    await handleWebhook(body, sign(body, HOOK), id);
    expect(await balance(db, ctx.workspaceId)).toBe(100);
  });

  it("a second checkout cancels the unpaid first one, and a second paid subscription never doubles the plan", async () => {
    const ctx = await ctxWith(0);
    const first = await createSubscription(ctx, { plan: "pro" });
    const second = await createSubscription(ctx, { plan: "studio" });
    expect(calls.some((c) => c.url.endsWith(`/subscriptions/${first.subscriptionId}/cancel`))).toBe(true);
    expect(await subStatus(first.subscriptionId)).toBe("ended");
    await activateSubscription(second.subscriptionId, `pay_b_${RUN}`);
    expect(await planOf(ctx.workspaceId)).toBe("studio");

    // Force a stray second created row that gets paid anyway: it is ended, not a 500.
    const rz = `sub_stray_${RUN}`;
    await db.insert(schema.subscriptions).values({ workspaceId: ctx.workspaceId, razorpaySubscriptionId: rz, plan: "pro" });
    await expect(activateSubscription(rz, `pay_c_${RUN}`)).resolves.toBe(false);
    expect(await subStatus(rz)).toBe("ended");
    expect(await planOf(ctx.workspaceId)).toBe("studio");
  });

  it("a charge processed after the end still credits, without bringing the plan back", async () => {
    const ctx = await ctxWith(0);
    const { subscriptionId } = await createSubscription(ctx, { plan: "pro" });
    await webhook("subscription.cancelled", { subscription: { entity: { id: subscriptionId } } });
    await webhook("subscription.charged", { subscription: { entity: { id: subscriptionId } }, payment: { entity: { id: `pay_late_${RUN}` } } });
    expect(await planOf(ctx.workspaceId)).toBe("free");
    expect(await balance(db, ctx.workspaceId)).toBe(1000);
  });

  it("cancelling never revives a subscription that already ended", async () => {
    const ctx = await ctxWith(0);
    const { subscriptionId } = await createSubscription(ctx, { plan: "pro" });
    await activateSubscription(subscriptionId, `pay_d_${RUN}`);
    // The end arrives while the cancel request is with Razorpay.
    vi.stubGlobal("fetch", vi.fn(async () => { await webhook("subscription.cancelled", { subscription: { entity: { id: subscriptionId } } }); return Response.json({}); }));
    await cancelSubscription(ctx);
    expect(await subStatus(subscriptionId)).toBe("ended");
  });

  it("the daily grant skips paying workspaces (they are topped up per charge)", async () => {
    const ctx = await ctxWith(0);
    const { subscriptionId } = await createSubscription(ctx, { plan: "pro" });
    await activateSubscription(subscriptionId, `pay_e_${RUN}`);
    await db.insert(schema.creditLedger).values({ workspaceId: ctx.workspaceId, delta: -900, reason: "adjust" });
    await grantMonthlyCredits(new Date(Date.now() + 40 * 86400_000));
    expect(await balance(db, ctx.workspaceId)).toBe(100);
  });
});
