"use client";

import { useEffect, useState } from "react";
import { runRefreshGuard } from "@/lib/refreshGuard.ts";
import { fetchDeployedBuildId, watchForUpdate } from "@/lib/updateWatcher.ts";

const DISMISSED_KEY = "chitrapx-update-dismissed";
/** Errors a stale tab hits after a deploy: they only prompt an immediate check, never the banner on their own. */
const STALE = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Failed to find Server Action/i;

const dismissedFor = () => { try { return localStorage.getItem(DISMISSED_KEY); } catch { return null; } };

/** A small, dismissible notice once a newer build is live. Never reloads by itself. */
export function UpdateBanner() {
  const current = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!current) return;
    const w = watchForUpdate({
      current,
      fetchBuildId: fetchDeployedBuildId,
      onUpdate: (id) => { if (dismissedFor() !== id) setNext(id); },
      subscribeVisible: (cb) => {
        const on = () => { if (document.visibilityState === "visible") cb(); };
        document.addEventListener("visibilitychange", on);
        return () => document.removeEventListener("visibilitychange", on);
      },
    });
    const onError = (e: ErrorEvent | PromiseRejectionEvent) => {
      const reason = "reason" in e ? e.reason : e.error ?? e.message;
      const text = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
      if (STALE.test(text)) w.checkNow();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    return () => { w.stop(); window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onError); };
  }, [current]);

  if (!next) return null;

  async function refresh() {
    setBusy(true);
    // In the editor this waits for the save; unsaved local edits also stay in this tab's draft.
    const saved = await runRefreshGuard();
    if (saved || window.confirm("Your latest changes are not saved yet. Refresh anyway?")) window.location.reload();
    else setBusy(false);
  }
  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, next!); } catch { /* private mode: dismiss for this page only */ }
    setNext(null);
  }

  return (
    <div role="status" className="relative z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-12 py-2 text-sm text-white">
      <span>A new version of Chitrapx is available.</span>
      <a href="/changelog" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">What&apos;s new</a>
      <button type="button" className="rounded-full bg-white/20 px-3 py-0.5 font-semibold transition hover:bg-white/30 focus-visible:outline-white disabled:opacity-60" onClick={refresh} disabled={busy}>{busy ? "Saving" : "Refresh"}</button>
      <button type="button" className="absolute right-3 grid size-7 place-items-center rounded-full transition hover:bg-white/20 focus-visible:outline-white" onClick={dismiss} aria-label="Dismiss">
        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}
