import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { disableShare, enableShare, getShare } from "@/server/shares.ts";

type P = { params: Promise<{ projectId: string }> };

/** GET: the live link or null. PUT { allowDuplicate?, expiresAt?, regenerate? }: turn on, update, or mint a new slug. DELETE: turn off. */
export const GET = route(async (_req: Request, { params }: P) => ({ share: await getShare(await requireContext(), (await params).projectId) }));
export const PUT = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext("share");
  return enableShare(ctx, (await params).projectId, await readJsonLimited(req, 1024, "Request too large"));
});
export const DELETE = route(async (_req: Request, { params }: P) => {
  await disableShare(await requireContext("share"), (await params).projectId);
});
