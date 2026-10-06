import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { restoreVersion } from "@/server/versions.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) => {
  const { projectId, versionId } = await params;
  return restoreVersion(await requireContext("edit"), projectId, versionId, await readJsonLimited(req, 4096, "Request too large"));
});
