import { requireContext } from "@/server/context.ts";
import { deleteFont } from "@/server/fonts.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ assetId: string }> }) => {
  await deleteFont(await requireContext("edit"), appStorage(), (await params).assetId);
});
