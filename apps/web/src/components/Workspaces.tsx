"use client";

import { useEffect, useState } from "react";
import { api } from "@/server/api.ts";
import { Notice, icon } from "@/components/Notice.tsx";

/** SP15: switch the current workspace (a cookie set by the server), then reload the dashboard. */
export function WorkspaceSwitcher({ current, workspaces }: { current: string; workspaces: Array<{ id: string; name: string; role: string }> }) {
  const [busy, setBusy] = useState(false);
  if (workspaces.length < 2) return null;
  return (
    <select aria-label="Workspace" className="input w-auto max-w-48 py-1" value={current} disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        await api("/api/workspaces/switch", "POST", { workspaceId: e.target.value }).catch(() => {});
        window.location.assign("/dashboard");
      }}>
      {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.role})</option>)}
    </select>
  );
}

/** The invite page's button: joins, switches to the workspace, opens the dashboard. */
export function AcceptInvite({ token, workspaceName }: { token: string; workspaceName: string }) {
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <button className="btn w-full" disabled={state === "busy"} onClick={async () => {
        setState("busy");
        setError("");
        try {
          await api("/api/invites/accept", "POST", { token });
          window.location.assign("/dashboard");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Something went wrong");
          setState("idle");
        }
      }}>Join {workspaceName}</button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Shown when the chosen workspace is no longer yours: go back to your own. */
export function AccessRemoved() {
  return (
    <Notice title="Access removed" body="You are no longer a member of this workspace. Your own workspaces are still here."
      icon={icon("M7 11V7a5 5 0 0 1 9.9-1M5 11h14v10H5z")}>
      <button className="btn w-full py-3" onClick={async () => {
        await api("/api/workspaces/switch", "POST", {}).catch(() => {});
        window.location.assign("/dashboard");
      }}>Go to my workspace <span aria-hidden>→</span></button>
      <form action="/auth/signout" method="post"><button className="text-xs font-medium text-neutral-500 transition hover:text-indigo-600">Sign out</button></form>
    </Notice>
  );
}

/** Polls /api/me (every 30 s and on focus) and blocks the page once the user is removed from the workspace. */
export function AccessWatcher() {
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== "visible") return;
      const res = await fetch("/api/me", { cache: "no-store" }).catch(() => null);
      if (res?.status === 403) setRemoved(true);
    };
    const timer = setInterval(check, 30_000);
    window.addEventListener("focus", check);
    return () => { stop = true; clearInterval(timer); window.removeEventListener("focus", check); };
  }, []);
  if (!removed) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Access removed" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <AccessRemoved />
    </div>
  );
}
