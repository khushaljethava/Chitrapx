import { PLANS } from "@chitrapx/db";
import { BillingPanel } from "@/components/BillingPanel.tsx";
import { billingOverview, CREDIT_PACKS } from "@/server/billing.ts";
import { requireContext } from "@/server/context.ts";

export const metadata = { title: "Billing · Chitrapx" };

export default async function BillingPage() {
  const o = await billingOverview(await requireContext());
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Plan and credits</h1>
        <p className="text-sm text-neutral-500">Your subscription, one-time credit packs and recent purchases.</p>
      </header>
      <BillingPanel
        configured={o.configured}
        currency={o.currency}
        plan={o.plan}
        subscription={o.subscription && { status: o.subscription.status, plan: o.subscription.plan, currentEnd: o.subscription.currentEnd?.toISOString() ?? null }}
        plans={(["pro", "studio"] as const).map((id) => ({ id, credits: PLANS[id].monthlyCredits, maxApps: PLANS[id].maxApps, price: process.env[`PRICE_LABEL_${id.toUpperCase()}`] ?? "" }))}
        packs={Object.entries(CREDIT_PACKS).map(([id, p]) => ({ id, ...p }))}
        payments={o.payments.map((p) => ({ id: p.id, credits: p.credits, amount: p.amount, currency: p.currency, paidAt: p.paidAt?.toISOString() ?? "" }))}
      />
    </>
  );
}
