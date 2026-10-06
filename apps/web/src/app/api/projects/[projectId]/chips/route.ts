import { startChips } from "@/server/ai.ts";
import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const ctx = await requireContext("spend");
  return Response.json(await startChips(ctx, await getBoss(), (await params).projectId), { status: 201 });
});
