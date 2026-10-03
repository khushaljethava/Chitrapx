"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import { ExportDialog } from "./ExportDialog.tsx";

export function ExportPanel({ projectId, doc }: { projectId: string; doc: ChitrapxDoc }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">Export</h2>
        <p className="text-sm text-neutral-500">PNGs at exact store sizes, in one ZIP, with a store-readiness report.</p>
      </div>
      <button className="btn" onClick={() => setOpen(true)}>Export</button>
      {open && <ExportDialog projectId={projectId} doc={doc} onClose={() => { setOpen(false); router.refresh(); }} />}
    </section>
  );
}
