"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOCALES } from "@chitrapx/renderer";
import { api } from "@/server/api.ts";
import { JOB_LABEL, jobError } from "./jobText.ts";

type Job = { id: string; type: string; status: string; error: string | null; createdAt: string };

/** AI job status for a project (refreshes the page when one finishes) and the translate action. */
export function ProjectAi({ projectId, appId, brief, codes }: { projectId: string; appId: string; brief: string; codes: string[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const seen = useRef<string | null>(null);

  const load = useCallback(async () => {
    const all = (await api<Job[]>(`/api/projects/${projectId}/jobs`)).filter((j) => j.type.startsWith("ai_") && j.type !== "ai_copy");
    const key = all.map((j) => j.id + j.status).join();
    if (seen.current !== null && seen.current !== key) router.refresh();
    seen.current = key;
    setJobs(all);
  }, [projectId, router]);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");

  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => {
    if (!active.length) return;
    const t = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [active.length, load]);

  async function translate() {
    setError("");
    try { await api(`/api/projects/${projectId}/translate`, "POST", { locales: chosen }); setChosen([]); await load(); router.refresh(); }
    catch (err) { setError((err as Error).message); }
  }

  const latestFailed = jobs.find((j) => j.status === "failed");
  return (
    <section className="card space-y-3">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        AI brief: {brief ? brief.split("\n")[0] : "none yet"}{" "}
        <Link href={`/dashboard/apps/${appId}#ai-brief`} className="text-indigo-600 hover:underline">Edit</Link>
      </p>
      {active.map((j) => (
        <p key={j.id} className="flex items-center gap-2 text-sm" role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
          {j.type === "ai_design" ? "AI is designing your screenshots. This takes about a minute." : `${JOB_LABEL[j.type]} in progress`}
        </p>
      ))}
      {!active.length && latestFailed && (
        <p className="text-sm text-red-600">{JOB_LABEL[latestFailed.type]} failed: {jobError(latestFailed.error)} Your credits were refunded.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="tr-locales">Translate into (2 credits per language)</label>
          <select id="tr-locales" multiple className="input h-24" value={chosen} onChange={(e) => setChosen([...e.target.selectedOptions].map((o) => o.value))}>
            {LOCALES.filter((l) => !codes.includes(l.code)).map((l) => <option key={l.code} value={l.code}>{l.nativeName} ({l.code})</option>)}
          </select>
        </div>
        <button className="btn" disabled={!chosen.length || active.length > 0} onClick={translate}>
          Translate{chosen.length ? ` (${chosen.length * 2} credits)` : ""}
        </button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
