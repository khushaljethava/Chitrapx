import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";
import { listAssets } from "@/server/uploads.ts";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ appId: string }> }) =>
  listAssets(await requireContext(), appStorage(), (await params).appId));
