import { z } from "zod";
import { currentUser, setCurrentWorkspace } from "@/server/context.ts";
import { HttpError, readJsonLimited, route } from "@/server/http.ts";
import { acceptInvite } from "@/server/members.ts";

/** POST { token }: the signed-in invitee joins and switches to the workspace. The invite itself authorizes. */
export const POST = route(async (req: Request) => {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "unauthenticated");
  const { token } = z.object({ token: z.string().min(1).max(200) }).parse(await readJsonLimited(req, 1024, "Request too large"));
  const joined = await acceptInvite(user, token);
  await setCurrentWorkspace(joined.workspaceId);
  return joined;
});
