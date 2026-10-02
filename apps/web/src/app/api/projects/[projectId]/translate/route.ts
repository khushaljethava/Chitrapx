import { startTranslate } from "@/server/ai.ts";
import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const ctx = await requireContext();
  return Response.json(await startTranslate(ctx, await getBoss(), (await params).projectId, await readJson(req)), { status: 201 });
});
