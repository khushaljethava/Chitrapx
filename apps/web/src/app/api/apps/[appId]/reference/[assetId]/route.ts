import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";
import { deleteReference } from "@/server/uploads.ts";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ appId: string; assetId: string }> }) => {
  const { appId, assetId } = await params;
  await deleteReference(await requireContext("edit"), appStorage(), appId, assetId);
});
