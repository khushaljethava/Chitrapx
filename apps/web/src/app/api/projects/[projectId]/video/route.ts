import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { enqueueVideo } from "@/server/jobs.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const ctx = await requireContext("spend");
  return Response.json(await enqueueVideo(ctx, await getBoss(), (await params).projectId, await readJson(req)), { status: 201 });
});
