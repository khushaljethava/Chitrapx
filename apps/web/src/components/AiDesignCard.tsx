"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/server/api.ts";

export function AiDesignCard({ appId, screenshotCount }: { appId: string; screenshotCount: number }) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const { projectId } = await api<{ projectId: string }>(`/api/apps/${appId}/ai-design`, "POST", { brief: brief || undefined });
      router.push(`/dashboard/projects/${projectId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <section className="card space-y-3 border-indigo-200 bg-gradient-to-br from-indigo-50 to-white dark:border-indigo-900 dark:from-indigo-950 dark:to-neutral-900">
      <div>
        <h2 className="font-semibold">Design with AI</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Chitrapx studies your screenshots, picks a template, orders the screens for conversion and writes the copy. You can change everything afterwards.
        </p>
      </div>
      <label className="label" htmlFor="ai-brief">Anything the AI should know? (optional)</label>
      <textarea id="ai-brief" className="input min-h-16" maxLength={2000} placeholder="Audience, tone, the features that matter most" value={brief} onChange={(e) => setBrief(e.target.value)} />
      <div className="flex items-center gap-3">
        <button className="btn" onClick={start} disabled={busy || screenshotCount === 0}>{busy ? "Starting" : "Design with AI (10 credits)"}</button>
        {screenshotCount === 0 && <span className="text-sm text-neutral-500">Upload screenshots below first.</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
