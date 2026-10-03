import { handleWebhook } from "@/server/billing.ts";
import { readTextLimited, route } from "@/server/http.ts";

/** Razorpay webhooks: unauthenticated, trusted only through the signature over the exact raw body. */
export const POST = route(async (req: Request) =>
  handleWebhook(await readTextLimited(req, 64 * 1024), req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id")));
