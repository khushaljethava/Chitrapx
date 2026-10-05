"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cleanLogoText, LOGO_SEED_MAX } from "@chitrapx/document";
import { followJob } from "@/lib/followJob.ts";
import { api, ApiError } from "@/server/api.ts";
import { jobError } from "./jobText.ts";
import type { LaunchImage } from "./launchModel.ts";
import { useJobDownload } from "./useJobDownload.ts";

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

/** 12.2: a seeded 1024 starter logo (free), saved to the app's images; one click turns it into icons. */
export function LogoStarterPanel({ appId, images }: { appId: string; images: LaunchImage[] }) {
  const router = useRouter();
  const icons = useJobDownload();
  const [text, setText] = useState("");
  const [seedField, setSeedField] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ assetId: string; seed: number } | null>(null);
  const logo = result ? images.find((i) => i.id === result.assetId) : undefined;
  const seedValue = seedField.trim() === "" ? null : Number(seedField);
  const seedOk = seedValue === null || (Number.isInteger(seedValue) && seedValue >= 0 && seedValue <= LOGO_SEED_MAX);

  async function generate(seed: number | null) {
    setBusy(true);
    setError("");
    try {
      const { jobId } = await api<{ jobId: string; seed: number }>("/api/launch-assets/logo", "POST", { appId, text, ...(seed === null ? {} : { seed }) });
      const job = await followJob(jobId, 1000, 120);
      if (job.status !== "done") { setError(jobError(job.error)); return; }
      const out = job.output as { assetId: string; seed: number };
      setResult(out);
      setSeedField(String(out.seed));
      router.refresh(); // the logo is now one of the app's images
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4" id="logo">
      <div>
        <h2 className="font-semibold">Starter logo</h2>
        <p className="text-sm text-neutral-500">A 1024×1024 logo from a gradient, soft shapes and a symbol, with up to 4 characters of text. Free. The same seed and text always give the same logo.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Text (optional)</span>
          <input className="input w-36" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder="AB" />
        </label>
        <label className="block">
          <span className="label">Seed</span>
          <input className="input w-40" inputMode="numeric" value={seedField} onChange={(e) => setSeedField(e.target.value)} placeholder="Random" aria-invalid={!seedOk} />
        </label>
        <button className="btn" disabled={busy || !seedOk} onClick={() => generate(seedValue)}>{busy ? "Generating…" : "Generate logo"}</button>
        {result && <button className="btn-ghost" disabled={busy} onClick={() => generate(randomSeed())}>Regenerate</button>}
      </div>
      {text && <p className="text-xs text-neutral-500">Drawn as “{cleanLogoText(text) ?? ""}”: spaces removed, at most 4 characters.</p>}
      {!seedOk && <p className="error">A seed is a whole number from 0 to {LOGO_SEED_MAX}.</p>}
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="flex flex-wrap items-center gap-4">
          {logo ? <img src={logo.url} alt="Starter logo" className="size-40 rounded-[22.37%] shadow" /> : <div className="size-40 animate-pulse rounded-[22.37%] bg-neutral-200" />}
          <div className="space-y-2 text-sm">
            <p>Seed <code>{result.seed}</code> <button className="text-indigo-600 hover:underline" onClick={() => navigator.clipboard?.writeText(String(result.seed))}>Copy seed</button></p>
            <button className="btn" disabled={icons.busy} onClick={() => icons.start("/api/launch-assets/icons", { assetId: result.assetId })}>
              {icons.busy ? "Making icons…" : "Use for icons (1 credit)"}
            </button>
            {icons.error && <p className="error">{icons.error}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
