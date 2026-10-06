import { after } from "next/server";
import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { broadcastHead } from "@/server/realtime.ts";
import { restoreVersion } from "@/server/versions.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) => {
  const { projectId, versionId } = await params;
  const restored = await restoreVersion(await requireContext(), projectId, versionId, await readJsonLimited(req, 4096, "Request too large"));
  // SP15: live peers see the hole in the command log and load the restored document.
  after(() => broadcastHead(projectId, restored.revision));
  return restored;
});
