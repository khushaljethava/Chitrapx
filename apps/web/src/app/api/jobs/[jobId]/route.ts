import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { getJob } from "@/server/jobs.ts";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ jobId: string }> }) =>
  getJob(await requireContext(), (await params).jobId));
