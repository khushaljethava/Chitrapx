import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { enqueueMockup } from "@/server/launchAssets.ts";

export const POST = route(async (req: Request) => {
  const ctx = await requireContext("spend");
  return Response.json(await enqueueMockup(ctx, await getBoss(), await readJson(req)), { status: 201 });
});
