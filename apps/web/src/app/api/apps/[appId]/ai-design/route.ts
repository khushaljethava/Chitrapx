import { startAiDesign } from "@/server/ai.ts";
import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ appId: string }> }) => {
  const ctx = await requireContext();
  return Response.json(await startAiDesign(ctx, await getBoss(), (await params).appId, await readJson(req)), { status: 201 });
});
