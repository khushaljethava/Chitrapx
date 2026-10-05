import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { enqueueCollage } from "@/server/launchAssets.ts";

export const POST = route(async (req: Request) => {
  const ctx = await requireContext();
  return Response.json(await enqueueCollage(ctx, await getBoss(), await readJson(req)), { status: 201 });
});
