import { clientKey } from "@/lib/rateLimit.ts";
import { HttpError, route } from "@/server/http.ts";
import { sharedView, viewLimit } from "@/server/shares.ts";

export const dynamic = "force-dynamic";

/** GET /api/shared/<slug>: the public, read-only preview. No session; 404 once the link is off. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  if (!viewLimit(clientKey(req.headers))) throw new HttpError(429, "rate_limited", "Too many requests. Try again in a minute.");
  return Response.json(await sharedView((await params).slug), { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
});
