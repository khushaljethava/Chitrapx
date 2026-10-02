import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { listJobs } from "@/server/jobs.ts";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ projectId: string }> }) =>
  listJobs(await requireContext(), { projectId: (await params).projectId, limit: 20 }));
