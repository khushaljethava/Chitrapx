"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/server/api.ts";

type RazorpayResponse = Record<string, string>;
type RazorpayOptions = {
  key: string; order_id?: string; subscription_id?: string; amount?: number; currency?: string; name: string; description: string;
  handler: (r: RazorpayResponse) => void; modal: { ondismiss: () => void }; theme: { color: string };
};
declare global { interface Window { Razorpay?: new (o: RazorpayOptions) => { open(): void } } }

/** Loads Razorpay Checkout once, on first use. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window"));
    document.head.appendChild(s);
  });
}

const money = (amount: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);

export function BillingPanel({ configured, currency, plan, subscription, plans, packs, payments }: {
  configured: boolean; currency: string; plan: string;
  subscription: { status: string; plan: string; currentEnd: string | null } | null;
  plans: Array<{ id: "pro" | "studio"; credits: number; maxApps: number; price: string }>;
  packs: Array<{ id: string; credits: number; amount: number }>;
  payments: Array<{ id: string; credits: number; amount: number; currency: string; paidAt: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function checkout(key: string, start: () => Promise<Omit<RazorpayOptions, "handler" | "modal" | "theme" | "name">>, verifyPath: string, done: string) {
    setBusy(key); setMessage(null);
    try {
      await loadCheckout();
      const opts = await start();
      new window.Razorpay!({
        ...opts, name: "Chitrapx", theme: { color: "#4f46e5" },
        handler: async (r) => {
          try { await api(verifyPath, "POST", r); setMessage(done); router.refresh(); } catch (e) { setMessage((e as Error).message); }
          setBusy(null);
        },
        modal: { ondismiss: () => setBusy(null) },
      }).open();
    } catch (e) { setMessage((e as Error).message); setBusy(null); }
  }

  const buyPack = (id: string, credits: number) => checkout(`pack:${id}`, async () => {
    const o = await api<{ orderId: string; amount: number; currency: string; keyId: string }>("/api/billing/orders", "POST", { pack: id });
    return { key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency, description: `${credits} credits` };
  }, "/api/billing/orders/verify", `${credits} credits added.`);

  const subscribe = (id: "pro" | "studio") => checkout(`plan:${id}`, async () => {
    const s = await api<{ subscriptionId: string; keyId: string }>("/api/billing/subscriptions", "POST", { plan: id });
    return { key: s.keyId, subscription_id: s.subscriptionId, description: `${id === "pro" ? "Pro" : "Studio"} plan, monthly` };
  }, "/api/billing/subscriptions/verify", "Your plan is active.");

  async function cancel() {
    setBusy("cancel"); setMessage(null);
    try { await api("/api/billing/subscriptions/cancel", "POST"); setMessage("Your plan ends at the end of this billing period."); router.refresh(); }
    catch (e) { setMessage((e as Error).message); }
    setBusy(null);
  }

  const ends = subscription?.currentEnd ? new Date(subscription.currentEnd).toLocaleDateString() : null;
  return (
    <div className="space-y-6">
      {!configured && <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">Payments are not set up on this server yet.</p>}
      {message && <p role="status" className="card text-sm">{message}</p>}

      <section className="card space-y-4">
        <h2 className="font-semibold">Plan</h2>
        <p className="text-sm">
          You are on <strong className="capitalize">{plan}</strong>.
          {subscription?.status === "cancelling" && ends && <> It ends on {ends}.</>}
          {subscription?.status === "active" && ends && <> Renews on {ends}.</>}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((p) => (
            <div key={p.id} aria-current={plan === p.id ? "true" : undefined}
              className={`flex flex-col rounded-2xl border p-5 transition ${plan === p.id
                ? "border-indigo-300 bg-indigo-50/60 ring-2 ring-indigo-500 dark:border-indigo-800 dark:bg-indigo-950/30"
                : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold capitalize">{p.id}</h3>
                {plan === p.id && <span className="chip bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white">Current plan</span>}
              </div>
              {p.price && <p className="mt-1 font-display text-2xl font-bold">{p.price}</p>}
              <p className="mt-2 flex-1 text-sm text-neutral-500">{p.credits.toLocaleString()} credits a month · {Number.isFinite(p.maxApps) ? `${p.maxApps} apps` : "unlimited apps"}</p>
              {plan === p.id && subscription?.status === "active"
                ? <button type="button" className="btn-ghost mt-4 self-start" disabled={busy !== null} onClick={cancel}>Cancel plan</button>
                : <button type="button" className="btn mt-4 self-start" disabled={!configured || busy !== null || !!subscription} onClick={() => subscribe(p.id)}>
                    {busy === `plan:${p.id}` ? "Opening…" : `Choose ${p.id === "pro" ? "Pro" : "Studio"}`}
                  </button>}
            </div>
          ))}
        </div>
        {subscription && plan !== subscription.plan && <p className="text-xs text-neutral-500">To switch plans, cancel the current one first.</p>}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Credit packs</h2>
        <p className="text-sm text-neutral-500">One-time top-ups for AI and exports. Pack credits never expire.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {packs.map((p) => (
            <button key={p.id} type="button" className="btn-ghost flex-col gap-1 rounded-2xl py-5 hover:border-indigo-300 dark:hover:border-indigo-800" disabled={!configured || busy !== null} onClick={() => buyPack(p.id, p.credits)}>
              <span className="font-display text-lg font-semibold">{p.credits.toLocaleString()} credits</span>
              <span className="text-neutral-500">{busy === `pack:${p.id}` ? "Opening…" : money(p.amount, currency)}</span>
            </button>
          ))}
        </div>
      </section>

      {payments.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Recent purchases</h2>
          <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
                <span>{p.credits.toLocaleString()} credits</span>
                <span className="text-neutral-500">{money(p.amount, p.currency)} · {new Date(p.paidAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
