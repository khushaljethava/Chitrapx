import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { MAX_DOC_BYTES, saveDoc } from "@/server/projects.ts";

export const PUT = route(async (req: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const ctx = await requireContext();
  // The document plus its small wrapper; counted while reading, never trusting Content-Length.
  return saveDoc(ctx, (await params).projectId, await readJsonLimited(req, MAX_DOC_BYTES + 1024));
});
