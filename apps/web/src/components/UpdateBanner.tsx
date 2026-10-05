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
    <div role="status" className="fixed inset-x-0 bottom-4 z-[60] mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
      <span>A new version of Chitrapx is available.</span>
      <a href="/changelog" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">What&apos;s new</a>
      <button type="button" className="btn py-1" onClick={refresh} disabled={busy}>{busy ? "Saving" : "Refresh"}</button>
      <button type="button" className="btn-ghost py-1" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
