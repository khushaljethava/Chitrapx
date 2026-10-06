import { after } from "next/server";
import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { MAX_DOC_BYTES, saveDoc } from "@/server/projects.ts";
import { broadcastHead } from "@/server/realtime.ts";

export const PUT = route(async (req: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const ctx = await requireContext("edit");
  const projectId = (await params).projectId;
  // The document plus its small wrapper; counted while reading, never trusting Content-Length.
  const saved = await saveDoc(ctx, projectId, await readJsonLimited(req, MAX_DOC_BYTES + 1024));
  // SP15: a whole-document save leaves a hole in the command log; live peers catch up with a snapshot.
  after(() => broadcastHead(projectId, saved.revision));
  return saved;
});
