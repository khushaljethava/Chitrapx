"use client";

import { useState } from "react";
import { api } from "@/server/api.ts";
import { jobError } from "@/components/jobText.ts";
import { useEditor, useEditorStore } from "../context.tsx";

type Variant = { tone: string; texts: Array<{ id: string; text: string }> };
type Job = { id: string; status: string; error: string | null; output: { variants?: Variant[] } | null };

/** Generates three tone variants of every text (3 credits) and applies one as a single undo step. */
export function CopyIdeas() {
  const store = useEditorStore();
  const projectId = useEditor((s) => s.projectId);
  const [state, setState] = useState<"idle" | "working" | "ready">("idle");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [error, setError] = useState("");

  async function generate() {
    setError("");
    setState("working");
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/projects/${projectId}/copy-variants`, "POST");
      // Follows this one job (not a recent-jobs list) for as long as the job may run.
      for (let i = 0; i < 330; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await api<Job>(`/api/jobs/${jobId}`);
        if (job?.status === "done") { setVariants(job.output?.variants ?? []); setState("ready"); return; }
        if (job?.status === "failed") throw new Error(jobError(job.error));
      }
      throw new Error("This is taking longer than expected. Check back in a minute.");
    } catch (err) { setError((err as Error).message); setState("idle"); }
  }

  return (
    <section className="space-y-2">
      <h2 className="label">Copy ideas</h2>
      <button type="button" className="btn-ghost w-full px-2 py-1.5" onClick={generate} disabled={state === "working"}>
        {state === "working" ? "Writing three versions" : "Suggest copy (3 credits)"}
      </button>
      {error && <p role="alert" className="error text-xs">{error}</p>}
      {state === "ready" && variants.map((v) => (
        <div key={v.tone} className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium capitalize">{v.tone}</span>
            <button type="button" className="text-indigo-600 hover:underline" onClick={() => store.getState().apply({ type: "setTexts", texts: v.texts })}>Apply</button>
          </div>
          <p className="line-clamp-3 text-neutral-600 dark:text-neutral-400">{v.texts.slice(0, 3).map((t) => t.text).join(" · ")}</p>
        </div>
      ))}
    </section>
  );
}
