import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { balance, db, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import type { Ctx } from "@/server/context.ts";
import {
  cancelSubscription, createOrder, createSubscription, handleWebhook, signatureValid, verifyOrderPayment, verifySubscriptionPayment,
} from "@/server/billing.ts";

const KEY = "test_key_secret", HOOK = "test_webhook_secret";
const sign = (payload: string, key = KEY) => createHmac("sha256", key).update(payload).digest("hex");
let seq = 0;
/** The test database persists between runs; Razorpay ids are globally unique, so ours must be too. */
const RUN = Date.now().toString(36);
/** Fake Razorpay: returns a fresh id for whatever is created and records the calls. */
const calls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  Object.assign(process.env, { RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: KEY, RAZORPAY_WEBHOOK_SECRET: HOOK, RAZORPAY_PLAN_PRO: "plan_pro", RAZORPAY_PLAN_STUDIO: "plan_studio" });
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
  return { userId: "", workspaceId: ws, plan: "free" };
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

describe("credit packs", () => {
  it("adds credits once, whether checkout and the webhook both report the payment", async () => {
    const ctx = await ctxWith(0);
    const order = await createOrder(ctx, { pack: "small" });
    expect(calls[0]!.body).toMatchObject({ amount: 49900, currency: "INR" });
    const v = { razorpay_order_id: order.orderId, razorpay_payment_id: `pay_1_${RUN}` };
    await expect(verifyOrderPayment(ctx, { ...v, razorpay_signature: sign("x") })).rejects.toMatchObject({ code: "invalid_signature" });
    expect(await balance(db, ctx.workspaceId)).toBe(0);

    await verifyOrderPayment(ctx, { ...v, razorpay_signature: sign(`${order.orderId}|pay_1_${RUN}`) });
    await webhook("payment.captured", { payment: { entity: { id: `pay_1_${RUN}`, order_id: order.orderId, amount: 49900, currency: "INR" } } });
    await verifyOrderPayment(ctx, { ...v, razorpay_signature: sign(`${order.orderId}|pay_1_${RUN}`) });
    expect(await balance(db, ctx.workspaceId)).toBe(100);
  });

  it("refuses another workspace's order and a webhook with the wrong amount", async () => {
    const a = await ctxWith(0), b = await ctxWith(0);
    const order = await createOrder(a, { pack: "medium" });
    await expect(verifyOrderPayment(b, { razorpay_order_id: order.orderId, razorpay_payment_id: `pay_2_${RUN}`, razorpay_signature: sign(`${order.orderId}|pay_2_${RUN}`) }))
      .rejects.toMatchObject({ code: "unknown_order" });
    await webhook("payment.captured", { payment: { entity: { id: `pay_2_${RUN}`, order_id: order.orderId, amount: 100, currency: "INR" } } });
    expect(await balance(db, a.workspaceId)).toBe(0);
  });

  it("rejects webhooks with a bad signature and ignores repeated event ids", async () => {
    const ctx = await ctxWith(0);
    const order = await createOrder(ctx, { pack: "small" });
    const body = JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: `pay_3_${RUN}`, order_id: order.orderId, amount: 49900, currency: "INR" } } } });
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
