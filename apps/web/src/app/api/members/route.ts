import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { listMembers } from "@/server/members.ts";

/** GET /api/members: everyone in the current workspace, seats, and (admins) pending invites. */
export const GET = route(async () => listMembers(await requireContext()));
