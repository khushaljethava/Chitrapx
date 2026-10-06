import { requireContext, setCurrentWorkspace } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { changeRole, removeMember } from "@/server/members.ts";

type P = { params: Promise<{ userId: string }> };

/** PATCH { role }: admins and the owner; `owner` transfers ownership (owner only). Authorized inside changeRole. */
export const PATCH = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext();
  return changeRole(ctx, (await params).userId, await readJsonLimited(req, 1024, "Request too large"));
});

/** DELETE: remove a member (admins and the owner) or, for your own id, leave the workspace. */
export const DELETE = route(async (_req: Request, { params }: P) => {
  const ctx = await requireContext();
  const { userId } = await params;
  await removeMember(ctx, userId);
  if (userId === ctx.userId) await setCurrentWorkspace(null);
});
