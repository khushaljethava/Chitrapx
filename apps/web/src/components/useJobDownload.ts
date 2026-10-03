"use client";

import { useState } from "react";
import { api, ApiError } from "@/server/api.ts";
import { jobError } from "./jobText.ts";

type Job = { id: string; status: string; error: string | null };

/** Queues a free job, follows it, then downloads its file. `before` runs first (e.g. saving the editor). */
export function useJobDownload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(path: string, body: unknown, before?: () => Promise<boolean>) {
    setError("");
    setBusy(true);
    try {
      if (before && !(await before())) { setError("Save your changes first."); return; }
      const { jobId } = await api<{ jobId: string }>(path, "POST", body);
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await api<Job>(`/api/jobs/${jobId}`);
        if (job.status === "done") { window.location.assign(`/api/jobs/${jobId}/download`); return; }
        if (job.status === "failed") { setError(jobError(job.error)); return; }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, start };
}
