"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { putSigned } from "@/lib/uploadAsset.ts";
import { api } from "@/server/api.ts";
import { jobError } from "./jobText.ts";

type Job = { status: string; error: string | null; output: { projectId?: string } | null };

export function ImportProjectButton({ appId }: { appId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function onFile(file: File) {
    setError("");
    setBusy(true);
    try {
      const signed = await api<{ uploadId: string; url: string; headers: Record<string, string> }>(`/api/apps/${appId}/imports/sign`, "POST", { size: file.size });
      await putSigned(signed, file);
      const name = file.name.replace(/\.chitrapx$/i, "").slice(0, 120) || "Imported project";
      const { jobId } = await api<{ jobId: string }>(`/api/apps/${appId}/imports`, "POST", { uploadId: signed.uploadId, name });
      for (let i = 0; i < 900; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!alive.current) return;
        const job = await api<Job>(`/api/jobs/${jobId}`);
        if (!alive.current) return;
        if (job.status === "done" && job.output?.projectId) { router.push(`/dashboard/projects/${job.output.projectId}`); return; }
        if (job.status === "failed") { setError(jobError(job.error)); return; }
      }
      setError("This is taking longer than usual. Try again in a minute.");
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      if (alive.current) setBusy(false);
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
