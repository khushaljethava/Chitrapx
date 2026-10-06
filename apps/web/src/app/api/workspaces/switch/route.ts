import { z } from "zod";
import { currentUser, setCurrentWorkspace } from "@/server/context.ts";
import { HttpError, readJsonLimited, route } from "@/server/http.ts";
import { assertMember } from "@/server/members.ts";

/** POST { workspaceId? }: switch to one of your workspaces; without an id, back to your first one. */
export const POST = route(async (req: Request) => {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "unauthenticated");
  const { workspaceId } = z.object({ workspaceId: z.uuid().nullish() }).parse(await readJsonLimited(req, 1024, "Request too large"));
  if (workspaceId) await assertMember(user.id, workspaceId);
  await setCurrentWorkspace(workspaceId ?? null);
});
