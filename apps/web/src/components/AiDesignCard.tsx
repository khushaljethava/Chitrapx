"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BRIEF_MAX, BRIEF_TONES, type AppBriefFields } from "@chitrapx/document";
import { api } from "@/server/api.ts";

const keywordList = (s: string) => s.split(",").map((k) => k.trim()).filter(Boolean);

/** The brief is saved on the app when a design starts, so it is prefilled next time and reused by copy variants and chips. */
export function AiDesignCard({ appId, screenshotCount, brief: saved }: { appId: string; screenshotCount: number; brief: AppBriefFields }) {
  const router = useRouter();
  const [form, setForm] = useState({ text: saved.text ?? "", audience: saved.audience ?? "", tone: saved.tone ?? "", keywords: (saved.keywords ?? []).join(", ") });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const length = form.text.trim().length;

  async function start() {
    setBusy(true);
    setError("");
    try {
      const { projectId } = await api<{ projectId: string }>(`/api/apps/${appId}/ai-design`, "POST", {
        brief: form.text, audience: form.audience, tone: form.tone, keywords: keywordList(form.keywords),
      });
      router.push(`/dashboard/projects/${projectId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <section id="ai-brief" className="card space-y-3 border-indigo-200 bg-gradient-to-br from-indigo-50 to-white dark:border-indigo-900 dark:from-indigo-950 dark:to-neutral-900">
      <div>
        <h2 className="font-semibold">Design with AI</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Chitrapx studies your screenshots, picks a template, orders the screens for conversion and writes the copy. You can change everything afterwards.
        </p>
      </div>
      <label className="label" htmlFor="ai-brief-text">Anything the AI should know? (optional)</label>
      <textarea id="ai-brief-text" className="input min-h-16" placeholder="Audience, tone, the features that matter most" value={form.text}
        onChange={(e) => set({ text: e.target.value })} aria-describedby="ai-brief-count" />
      <p id="ai-brief-count" className={`text-xs ${length > BRIEF_MAX ? "text-red-600" : "text-neutral-500"}`}>{length} / {BRIEF_MAX}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="ai-audience">Audience</label>
          <input id="ai-audience" className="input" placeholder="Who the app is for" value={form.audience} onChange={(e) => set({ audience: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="ai-tone">Tone</label>
          <select id="ai-tone" className="input" value={form.tone} onChange={(e) => set({ tone: e.target.value as typeof form.tone })}>
            <option value="">Any</option>
            {BRIEF_TONES.map((t) => <option key={t} value={t}>{t[0]!.toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ai-keywords">Keywords</label>
          <input id="ai-keywords" className="input" placeholder="comma, separated" value={form.keywords} onChange={(e) => set({ keywords: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" onClick={start} disabled={busy || screenshotCount === 0}>{busy ? "Starting" : "Design with AI (10 credits)"}</button>
        {screenshotCount === 0 && <span className="text-sm text-neutral-500">Upload screenshots below first.</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
