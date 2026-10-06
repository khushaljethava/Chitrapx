import { createApp, listApps } from "@/server/apps.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";

export const GET = route(async () => listApps(await requireContext()));
export const POST = route(async (req: Request) => {
  const ctx = await requireContext("edit");
  return Response.json(await createApp(ctx, await readJson(req)), { status: 201 });
});
