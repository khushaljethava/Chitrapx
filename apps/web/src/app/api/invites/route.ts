import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { createInvite } from "@/server/members.ts";

/** POST { email, role }: a single-use invite link, returned once. No email is sent. */
export const POST = route(async (req: Request) => {
  const ctx = await requireContext("members");
  const invite = await createInvite(ctx, await readJsonLimited(req, 1024, "Request too large"));
  return Response.json({ ...invite, url: `${new URL(req.url).origin}${invite.path}` }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
