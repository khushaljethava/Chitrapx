"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/server/api.ts";

type Share = { slug: string; path: string; allowDuplicate: boolean; expiresAt: string | null };

/** SP15: the project's read-only link. Anyone with it can view; turning it off or regenerating kills the old URL at once. */
export function SharePanel({ projectId, initial, canShare }: { projectId: string; initial: Share | null; canShare: boolean }) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<Share | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = share && typeof window !== "undefined" ? `${window.location.origin}${share.path}` : share?.path ?? "";

  async function put(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      setShare(await api<Share>(`/api/projects/${projectId}/share`, "PUT", body));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  async function off() {
    setBusy(true);
    await api(`/api/projects/${projectId}/share`, "DELETE").then(() => setShare(null), (e) => setError(e.message));
    setBusy(false);
  }

  return (
    <div className="relative">
      <button type="button" className="btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{share ? "Shared link" : "Share link"}</button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(24rem,calc(100vw-2rem))] space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Anyone with the link sees a read-only preview. Comments and your workspace stay private.</p>
          {!share ? (
            canShare ? <button className="btn w-full" disabled={busy} onClick={() => put({})}>Create link</button>
              : <p className="text-sm text-neutral-500">Only editors, admins and the owner can share.</p>
          ) : (
            <>
              <div className="flex gap-2">
                <input readOnly aria-label="Share link" className="input min-w-0 bg-neutral-50 font-mono text-xs dark:bg-neutral-950" value={url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn-ghost shrink-0" onClick={() => void navigator.clipboard?.writeText(url)}>Copy</button>
              </div>
              {canShare && (
                <>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={share.allowDuplicate} disabled={busy} onChange={(e) => put({ allowDuplicate: e.target.checked })} />
                    Let signed-in visitors copy it into their workspace
                  </label>
                  <label className="block text-sm">
                    <span className="label">Expires (optional)</span>
                    <input type="date" className="input" disabled={busy} value={share.expiresAt?.slice(0, 10) ?? ""}
                      onChange={(e) => put({ expiresAt: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null })} />
                  </label>
                  <div className="flex justify-between border-t border-neutral-200 pt-3 dark:border-neutral-800">
                    <button className="btn-ghost" disabled={busy} onClick={() => put({ regenerate: true })}>New link</button>
                    <button className="btn-danger" disabled={busy} onClick={off}>Turn off</button>
                  </div>
                </>
              )}
            </>
          )}
          {error && <p role="alert" className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** On the public page: copy the shared project into the visitor's current workspace. */
export function DuplicateShared({ slug, signedIn, apps }: { slug: string; signedIn: boolean; apps: Array<{ id: string; name: string }> }) {
  const [appId, setAppId] = useState(apps[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; upgrade?: boolean } | null>(null);
  if (!signedIn) return <Link className="btn" href={`/login?next=${encodeURIComponent(`/s/${slug}`)}`}>Sign in to duplicate</Link>;
  if (!apps.length) return <Link className="btn-ghost" href="/dashboard">Create an app to copy this into</Link>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {apps.length > 1 && (
        <select aria-label="Copy into app" className="input w-auto max-w-full" value={appId} onChange={(e) => setAppId(e.target.value)}>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          const { projectId } = await api<{ projectId: string }>(`/api/shared/${slug}/duplicate`, "POST", { appId });
          window.location.assign(`/editor/${projectId}`);
        } catch (e) {
          setError(e instanceof ApiError ? { message: e.message, upgrade: e.code === "plan_limit" } : { message: "Something went wrong" });
          setBusy(false);
        }
      }}>Duplicate into my workspace</button>
      {error && <p role="alert" className="w-full text-sm text-red-600">{error.message} {error.upgrade && <Link className="underline" href="/dashboard/billing">Upgrade</Link>}</p>}
    </div>
  );
}
