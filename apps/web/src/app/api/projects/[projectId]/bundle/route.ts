import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { enqueueBundle } from "@/server/jobs.ts";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ projectId: string }> }) =>
  Response.json(await enqueueBundle(await requireContext("spend"), await getBoss(), (await params).projectId), { status: 201 }));
