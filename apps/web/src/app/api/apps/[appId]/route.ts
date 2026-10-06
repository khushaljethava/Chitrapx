import { deleteApp, updateApp } from "@/server/apps.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";

type P = { params: Promise<{ appId: string }> };

export const PATCH = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext("edit");
  return updateApp(ctx, (await params).appId, await readJson(req));
});
export const DELETE = route(async (_req: Request, { params }: P) => {
  await deleteApp(await requireContext("edit"), (await params).appId);
});
