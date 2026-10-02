"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/server/api.ts";

type ExportJob = { id: string; status: string; error: string | null; createdAt: string; output: { files?: number; bytes?: number } | null };

export function ExportPanel({ projectId, boardCount, localeCount }: { projectId: string; boardCount: number; localeCount: number }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => api<ExportJob[]>(`/api/projects/${projectId}/export`).then(setJobs), [projectId]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => {
    if (!active) { router.refresh(); return; }
    const t = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [active, load, router]);

  async function start() {
    setError("");
    try { await api(`/api/projects/${projectId}/export`, "POST", {}); await load(); router.refresh(); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Export</h2>
          <p className="text-sm text-neutral-500">{boardCount * localeCount} PNGs at exact store sizes, in one ZIP.</p>
        </div>
        <button className="btn" onClick={start} disabled={active || boardCount === 0}>{active ? "Exporting" : "Export ZIP (1 credit)"}</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {jobs.length > 0 && (
        <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-neutral-500">{new Date(j.createdAt).toLocaleString()}</span>
              {j.status === "done" ? (
                <a className="font-medium text-indigo-600 hover:underline" href={`/api/jobs/${j.id}/download`}>
                  Download {j.output?.files} PNGs ({((j.output?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB)
                </a>
              ) : j.status === "failed" ? (
                <span className="text-red-600" title={j.error ?? ""}>Failed, credit refunded</span>
              ) : (
                <span>{j.status === "queued" ? "Waiting" : "Rendering"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
