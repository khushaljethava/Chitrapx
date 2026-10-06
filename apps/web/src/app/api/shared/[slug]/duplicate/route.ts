import { requireContext } from "@/server/context.ts";
import { HttpError, readJsonLimited, route } from "@/server/http.ts";
import { duplicateLimit, duplicateShared } from "@/server/shares.ts";
import { appStorage } from "@/server/storage.ts";

/** POST { appId? }: copy the shared project into the signed-in user's current workspace. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const ctx = await requireContext("edit");
  if (!duplicateLimit(ctx.userId)) throw new HttpError(429, "rate_limited", "Too many copies at once. Try again in a minute.");
  const body = await readJsonLimited(req, 1024, "Request too large").catch(() => ({}));
  return Response.json(await duplicateShared(ctx, appStorage(), (await params).slug, body), { status: 201 });
});
