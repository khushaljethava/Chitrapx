"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/server/api.ts";

type Job = { id: string; type: string; status: string; error: string | null; createdAt: string };

/** Dev only: proves queue, worker and credits end to end. */
export function DevJobsPanel() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const seen = useRef<string | null>(null);

  const load = useCallback(async () => {
    const next = await api<Job[]>("/api/jobs");
    const key = next.map((j) => j.id + j.status).join();
    if (seen.current !== null && seen.current !== key) router.refresh(); // updates the credits badge
    seen.current = key;
    setJobs(next);
  }, [router]);

  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [active, load]);

  async function run(fail: boolean) {
    setError("");
    try { await api("/api/dev/noop", "POST", { fail }); await load(); } catch (err) { setError((err as Error).message); }
  }

  return (
    <section className="card space-y-3 border-dashed">
      <h2 className="font-semibold">Dev: job queue</h2>
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => run(false)}>Run noop (1 credit)</button>
        <button className="btn-ghost" onClick={() => run(true)}>Run failing noop</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <ul className="space-y-1 text-sm">
        {jobs.map((j) => (
          <li key={j.id} className="flex gap-3 font-mono text-xs">
            <span className="w-16">{j.status}</span><span>{j.type}</span><span className="text-neutral-500">{j.id.slice(0, 8)}</span>
            {j.error && <span className="text-red-600">{j.error}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
