import { after } from "next/server";
import { commandsSince, submitCommands } from "@/server/commands.ts";
import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { MAX_DOC_BYTES } from "@/server/projects.ts";
import { broadcastEntries } from "@/server/realtime.ts";

type P = { params: Promise<{ projectId: string }> };

/** SP15 live co-editing: catch up on the command log (`?after=<seq>&clientId=<uuid>`). */
export const GET = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext();
  const url = new URL(req.url);
  return commandsSince(ctx, (await params).projectId, url.searchParams.get("after"), url.searchParams.get("clientId"));
});

/** SP15 live co-editing: submit a batch of commands; peers hear about them after commit. */
export const POST = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext("edit");
  const body = await readJsonLimited(req, MAX_DOC_BYTES + 64 * 1024, "Request too large");
  return submitCommands(ctx, (await params).projectId, body, {
    onCommitted: (projectId, head, entries) => after(() => broadcastEntries(projectId, head, entries)),
  });
});
