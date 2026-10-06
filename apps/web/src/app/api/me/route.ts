import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";

/** GET /api/me: the current workspace and role. 403 access_removed once the user is removed from it. */
export const GET = route(async () => {
  const { userId, workspaceId, plan, role } = await requireContext();
  return Response.json({ userId, workspaceId, plan, role }, { headers: { "Cache-Control": "no-store" } });
});
