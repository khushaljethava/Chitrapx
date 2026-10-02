import { requireContext } from "@/server/context.ts";
import { HttpError, readJson, route } from "@/server/http.ts";
import { MAX_DOC_BYTES, saveDoc } from "@/server/projects.ts";

export const PUT = route(async (req: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const ctx = await requireContext();
  // Refuse before parsing: a declared oversize body never reaches JSON.parse.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_DOC_BYTES + 1024) throw new HttpError(413, "too_large");
  return saveDoc(ctx, (await params).projectId, await readJson(req));
});
