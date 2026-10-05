import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { enqueueAppIcons } from "@/server/launchAssets.ts";

export const POST = route(async (req: Request) => {
  const ctx = await requireContext();
  return Response.json(await enqueueAppIcons(ctx, await getBoss(), await readJson(req)), { status: 201 });
});
