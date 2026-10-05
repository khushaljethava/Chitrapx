"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { followJob } from "@/lib/followJob.ts";
import { uploadAsset } from "@/lib/uploadAsset.ts";
import { api } from "@/server/api.ts";
import { jobError } from "./jobText.ts";
import { analyseLabel, insightOf, slotsLeft, type ReferenceRow } from "./referenceModel.ts";

/** Competitor screenshots the team uploads: analysed once each, summarised into the AI brief. Never exported or placed in projects. */
export function ReferenceBoard({ appId, rows, summary: saved }: { appId: string; rows: ReferenceRow[]; summary: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [summary, setSummary] = useState(saved);
  const left = slotsLeft(rows);

  async function upload(files: FileList) {
    const list = Array.from(files).slice(0, left);
    const failed: string[] = [];
    for (const [i, file] of list.entries()) {
      setBusy(`Uploading ${i + 1} of ${list.length}`);
      try { await uploadAsset(appId, "reference", file, { analysisRights: true }); }
      catch (err) {
        // Transfer errors already name the file (uploadAsset); sign and complete errors do not (F16).
        const msg = (err as Error).message;
        failed.push(msg.startsWith(`${file.name}: `) ? msg : `${file.name}: ${msg}`);
      }
    }
    if (files.length > list.length) failed.push(`Only ${left} more image${left === 1 ? "" : "s"} fit on the board.`);
    setErrors(failed);
    setBusy("");
    router.refresh();
  }

  async function analyse() {
    setBusy("Analysing");
    setErrors([]);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/apps/${appId}/reference`, "POST");
      const job = await followJob(jobId);
      if (job.status === "failed") throw new Error(jobError(job.error));
      setSummary((job.output as { summary?: string } | null)?.summary ?? summary);
      router.refresh();
    } catch (err) { setErrors([(err as Error).message]); }
    finally { setBusy(""); }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this image and its analysis?")) return;
    try { await api(`/api/apps/${appId}/reference/${id}`, "DELETE"); router.refresh(); }
    catch (err) { setErrors([(err as Error).message]); }
  }

  async function saveSummary() {
    try { await api(`/api/apps/${appId}`, "PATCH", { brief: { competitor: summary } }); setErrors([]); router.refresh(); }
    catch (err) { setErrors([(err as Error).message]); }
  }

  return (
    <section className="card space-y-3" aria-label="Competitor reference board">
      <div>
        <h2 className="font-semibold">Competitor reference board</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Upload screenshots from competing apps. Chitrapx reads each one once and adds a short competitive angle to your AI brief. These images are never exported or placed in projects.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
        <span>I have the right to analyse these images, for example public store screenshots used for research.</span>
      </label>
      <button type="button" className="btn-ghost" disabled={!rights || left === 0 || !!busy} onClick={() => input.current?.click()}>
        {busy.startsWith("Uploading") ? busy : left ? `Upload screenshots (${left} left)` : "The board is full (10 images)"}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      {errors.length > 0 && <ul role="alert" className="error list-disc pl-5 text-sm">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      {rows.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {rows.map((r) => {
            const insight = insightOf(r.insight);
            return (
              <li key={r.id} className="space-y-1 rounded-lg border border-neutral-200 p-1 text-xs dark:border-neutral-800">
                <img src={r.url} alt="Competitor screenshot" className="aspect-[9/19.5] w-full rounded object-cover" loading="lazy" />
                {insight ? (
                  <dl className="space-y-0.5">
                    <dt className="sr-only">Headline</dt><dd className="font-medium">“{insight.headline}”</dd>
                    <dt className="sr-only">Claims</dt><dd>Claims: {insight.benefit}</dd>
                    <dt className="sr-only">Layout</dt><dd>Layout: {insight.layout}</dd>
                    <dt className="sr-only">Mood</dt><dd>Mood: {insight.colourMood}</dd>
                    <dt className="sr-only">Stand apart</dt><dd>Stand apart: {insight.differentiate}</dd>
                  </dl>
                ) : <p className="text-neutral-500">Not analysed yet</p>}
                <button type="button" className="text-red-600 hover:underline" onClick={() => remove(r.id)}>Delete</button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn" disabled={!rows.length || !!busy} onClick={analyse}>{busy === "Analysing" ? "Analysing" : analyseLabel(rows)}</button>
      <div>
        <label className="label" htmlFor="ref-summary">Competitive angle (added to the AI brief as competitor notes)</label>
        <textarea id="ref-summary" className="input min-h-20" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Appears after the first analysis. Edit it freely." />
        <button type="button" className="btn-ghost mt-1" disabled={summary === saved} onClick={saveSummary}>Save notes</button>
      </div>
    </section>
  );
}
