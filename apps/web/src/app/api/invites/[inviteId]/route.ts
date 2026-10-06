import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { revokeInvite } from "@/server/members.ts";

/** DELETE: cancel a pending invite; its link stops working at once. */
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ inviteId: string }> }) => {
  await revokeInvite(await requireContext("members"), (await params).inviteId);
});
