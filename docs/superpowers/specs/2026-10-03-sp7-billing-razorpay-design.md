# Sub-project 7: Billing with Razorpay

Paid plans (Pro, Studio) as Razorpay subscriptions, and credit packs as one-time Razorpay orders. No Stripe.

## Decisions

- **Razorpay REST through `fetch`** (Basic auth with key id and secret), not the Node SDK: three endpoints (orders, subscriptions, cancel). Checkout runs in the browser with `checkout.razorpay.com/v1/checkout.js`.
- **Prices**
  - Plan prices live on Razorpay Plans created in the dashboard. Chitrapx stores only their ids, in `RAZORPAY_PLAN_PRO` and `RAZORPAY_PLAN_STUDIO`.
  - Credit packs are defined in code (`CREDIT_PACKS`: credits, amount in the smallest currency unit) in `RAZORPAY_CURRENCY` (default `INR`).
  - The launch values are placeholders and business-tunable.
- **Fulfilment is idempotent and needs a signature.** Credits and plan changes are only ever written after one of:
  - checkout's handler signature is verified: `HMAC_SHA256(order_id|payment_id)` for an order, `HMAC_SHA256(payment_id|subscription_id)` for a subscription, keyed with the key secret, and the server re-checks it;
  - a webhook signature is verified: `HMAC_SHA256(raw body)` keyed with `RAZORPAY_WEBHOOK_SECRET`.

  Both paths call the same fulfilment, and a second call does nothing.
- **Credit pack:**
  - `payments` has one row per order, with status `created` and then `paid`.
  - Fulfilment flips `created` to `paid` with `where status = 'created'` and writes the `purchase` ledger row in the same transaction.
  - The amount and currency always come from our row, never from the client.
  - A paid amount that differs from the row is refused.
- **Subscription:**
  - `subscriptions` has one row per Razorpay subscription, with a status.
  - Activation (verified checkout, or `subscription.activated` / `subscription.charged`) sets the workspace plan and tops credits up to the new allowance once per charged payment (`plan_grant`, note `pay:<payment id>`). Monthly top-ups continue through the existing daily grant.
  - `subscription.cancelled`, `halted` and `completed` return the workspace to `free`.
  - Cancelling from the app cancels at the end of the cycle.
  - A workspace has at most one live subscription; starting another while one is live is refused.
- **Webhook**
  - Route: `POST /api/billing/webhook`. It reads the raw body (64 KB max), checks the signature with a timing-safe compare, and dedupes on `x-razorpay-event-id` in `billing_events`.
  - The workspace is found through our own rows (order id, subscription id), never from notes alone.
  - Unknown events return 200 and are ignored.
- **RLS**: the new tables are read-only to workspace members, like every other table. Writes come only from the server.
- **UI**: `/dashboard/billing` shows the current plan with subscribe and cancel, credit packs, and recent payments. The header links to it from the credits badge.

## Out of scope

Invoices and GST details (Razorpay sends receipts), proration between Pro and Studio (cancel, then subscribe), coupons, and `razorpay_customer_id` (unused; Razorpay creates customers at checkout).
