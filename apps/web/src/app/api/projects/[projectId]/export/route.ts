import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { enqueueExport, listJobs } from "@/server/jobs.ts";

type P = { params: Promise<{ projectId: string }> };

export const GET = route(async (_req: Request, { params }: P) => {
  const ctx = await requireContext();
  return listJobs(ctx, { projectId: (await params).projectId, types: ["export"] });
});
export const POST = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext("spend");
  const body = await req.json().catch(() => ({ kind: "zip" }));
  return Response.json(await enqueueExport(ctx, await getBoss(), (await params).projectId, body), { status: 201 });
});
