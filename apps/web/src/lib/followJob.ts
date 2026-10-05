import { api } from "@/server/api.ts";

export type FollowedJob = { id: string; status: string; error: string | null; output: unknown };

/** Follows one job (not a recent-jobs list) until it finishes, for as long as a job may run. */
export async function followJob(jobId: string, everyMs = 2000, tries = 330): Promise<FollowedJob> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, everyMs));
    const job = await api<FollowedJob>(`/api/jobs/${jobId}`);
    if (job.status === "done" || job.status === "failed") return job;
  }
  throw new Error("This is taking longer than expected. Check back in a minute.");
}
