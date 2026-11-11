"use client";

import { useEffect, useState } from "react";
import { api } from "@/server/api.ts";
import { Notice, icon } from "@/components/Notice.tsx";
import { Icon, Menu } from "@/components/ui.tsx";

/** SP15: switch the current workspace (a cookie set by the server), then reload the dashboard. */
export function WorkspaceSwitcher({ current, workspaces }: { current: string; workspaces: Array<{ id: string; name: string; role: string }> }) {
  const [busy, setBusy] = useState(false);
  const active = workspaces.find((w) => w.id === current);
  if (workspaces.length < 2) return active ? <span className="hidden items-center gap-2 text-sm font-medium md:inline-flex"><WorkspaceMark name={active.name} />{active.name}</span> : null;
  return (
    <Menu label={`Workspace: ${active?.name ?? ""}`} buttonClassName="inline-flex max-w-32 items-center gap-2 rounded-control px-2 sm:max-w-48 py-1.5 text-sm font-medium transition hover:bg-ink/5"
      button={<>{active && <WorkspaceMark name={active.name} />}<span className="truncate">{active?.name}</span><Icon name="chevronDown" className="size-4 shrink-0 text-muted" /></>}>
      {(close) => (
        <>
          <p className="menu-label">Workspaces</p>
          {workspaces.map((w) => (
            <button key={w.id} type="button" role="menuitemradio" aria-checked={w.id === current} disabled={busy} className="menu-item aria-checked:bg-primary-tint disabled:opacity-50"
              onClick={async () => {
                if (w.id === current) return close();
                setBusy(true);
                await api("/api/workspaces/switch", "POST", { workspaceId: w.id }).catch(() => {});
                window.location.assign("/dashboard");
              }}>
              <WorkspaceMark name={w.name} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{w.name}</span><span className="block text-xs capitalize text-muted">{w.role}</span></span>
              {w.id === current && <Icon name="check" className="size-4 text-primary" />}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}

function WorkspaceMark({ name }: { name: string }) {
  return <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-primary-tint text-xs font-bold text-on-primary-tint">{name.slice(0, 1).toUpperCase()}</span>;
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
