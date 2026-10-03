"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser.ts";
import { api } from "@/server/api.ts";
import { jobError } from "./jobText.ts";

type Job = { status: string; error: string | null; output: { projectId?: string } | null };

export function ImportProjectButton({ appId }: { appId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFile(file: File) {
    setError("");
    setBusy(true);
    try {
      const signed = await api<{ uploadId: string; path: string; token: string }>(`/api/apps/${appId}/imports/sign`, "POST", { size: file.size });
      const { error: upErr } = await createClient().storage.from("uploads").uploadToSignedUrl(signed.path, signed.token, file, { contentType: "application/zip" });
      if (upErr) throw new Error(upErr.message);
      const name = file.name.replace(/\.chitrapx$/i, "").slice(0, 120) || "Imported project";
      const { jobId } = await api<{ jobId: string }>(`/api/apps/${appId}/imports`, "POST", { uploadId: signed.uploadId, name });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await api<Job>(`/api/jobs/${jobId}`);
        if (job.status === "done" && job.output?.projectId) { router.push(`/dashboard/projects/${job.output.projectId}`); return; }
        if (job.status === "failed") { setError(jobError(job.error)); return; }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <label className={`btn-ghost cursor-pointer ${busy ? "opacity-50" : ""}`}>
        {busy ? "Importing" : "Import project"}
        <input type="file" accept=".chitrapx" className="sr-only" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
      </label>
      {error && <span role="alert" className="error text-xs">{error}</span>}
    </span>
  );
}
