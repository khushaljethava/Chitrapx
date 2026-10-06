import { clientKey } from "@/lib/rateLimit.ts";
import { HttpError, route } from "@/server/http.ts";
import { assetLimit, sharedAsset } from "@/server/shares.ts";
import { appStorage } from "@/server/storage.ts";

export const dynamic = "force-dynamic";

/** One image, recording or font of a shared project, behind a signed one-hour URL; 404 once the link is off. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ slug: string; assetId: string }> }) => {
  if (!assetLimit(clientKey(req.headers))) throw new HttpError(429, "rate_limited");
  const { slug, assetId } = await params;
  const { body, contentType } = await sharedAsset(appStorage(), slug, assetId, new URL(req.url));
  return new Response(body, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=600", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" } });
});
