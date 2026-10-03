"use client";

import { useJobDownload } from "./useJobDownload.ts";

export function BundleButton({ projectId }: { projectId: string }) {
  const job = useJobDownload(900);
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="btn-ghost" disabled={job.busy} onClick={() => job.start(`/api/projects/${projectId}/bundle`, {})}>
        {job.busy ? "Packing" : "Download project file"}
      </button>
      {job.error && <span role="alert" className="error text-xs">{job.error}</span>}
    </span>
  );
}
