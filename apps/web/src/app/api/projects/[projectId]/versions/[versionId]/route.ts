import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { getVersion } from "@/server/versions.ts";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) => {
  const { projectId, versionId } = await params;
  return getVersion(await requireContext(), projectId, versionId);
});
