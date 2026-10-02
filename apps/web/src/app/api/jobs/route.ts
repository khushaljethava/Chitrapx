import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { listJobs } from "@/server/jobs.ts";

export const GET = route(async () => listJobs(await requireContext()));
