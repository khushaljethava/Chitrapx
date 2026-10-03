"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/server/api.ts";
import { jobError } from "./jobText.ts";

type Job = { id: string; status: string; error: string | null };

/** Queues a free job, follows it, then downloads its file. `before` runs first (e.g. saving the editor). */
export function useJobDownload(maxPolls = 120) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function start(path: string, body: unknown, before?: () => Promise<boolean>) {
    setError("");
    setBusy(true);
    try {
      if (before && !(await before())) { setError("Save your changes first."); return; }
      const { jobId } = await api<{ jobId: string }>(path, "POST", body);
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!alive.current) return;
        const job = await api<Job>(`/api/jobs/${jobId}`);
        if (!alive.current) return;
        if (job.status === "done") { window.location.assign(`/api/jobs/${jobId}/download`); return; }
        if (job.status === "failed") { setError(jobError(job.error)); return; }
      }
      setError("This is taking longer than usual. Try again in a minute.");
    } catch (err) {
      if (alive.current) setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return { busy, error, start };
}
