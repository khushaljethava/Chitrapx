"use client";

import { useState } from "react";
import { fontUploadMessage, uploadFont } from "@/lib/uploadAsset.ts";

/** One font file plus the embedding-rights confirmation; every error is shown inline. */
export function FontUploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (family: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !rights) return;
    setBusy(true); setError("");
    try { onUploaded((await uploadFont(file)).family); onClose(); }
    catch (err) { setError(fontUploadMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="font-upload-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <form onSubmit={submit} className="card w-96 space-y-3">
        <h2 id="font-upload-title" className="font-semibold">Upload a font</h2>
        <p className="text-xs text-neutral-500">TTF, OTF, WOFF or WOFF2, up to 10 MB. One file is one weight or style. Fonts are shared by every app in this workspace.</p>
        <input type="file" accept=".ttf,.otf,.woff,.woff2" aria-label="Font file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
          I have the right to embed this font in images I publish.
        </label>
        {error && <p role="alert" className="error text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={!file || !rights || busy}>{busy ? "Uploading" : "Upload"}</button>
        </div>
      </form>
    </div>
  );
}
