"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/server/api.ts";

/** Per-workspace admin controls: change the plan, grant or take back credits (with a reason, kept in the ledger). */
export function WorkspaceActions({ workspaceId, plan }: { workspaceId: string; plan: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(path: string, body: unknown, done: string) {
    setBusy(true); setMessage("");
    try { await api(path, "POST", { workspaceId, ...(body as object) }); setMessage(done); router.refresh(); }
    catch (e) { setMessage((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor={`plan-${workspaceId}`}>Plan</label>
      <select id={`plan-${workspaceId}`} className="input py-1" defaultValue={plan} disabled={busy}
        onChange={(e) => run("/api/admin/plan", { plan: e.target.value }, `Plan set to ${e.target.value}`)}>
        <option value="free">Free</option><option value="pro">Pro</option><option value="studio">Studio</option>
      </select>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run("/api/admin/credits", { delta: Number(f.get("delta")), note: String(f.get("note")) }, "Credits updated");
        e.currentTarget.reset();
      }}>
        <input name="delta" type="number" required step={1} placeholder="+100 or -50" aria-label="Credits to add or remove" className="input w-28 py-1" />
        <input name="note" required maxLength={200} placeholder="Reason" aria-label="Reason" className="input w-36 py-1" />
        <button className="btn-ghost py-1" disabled={busy}>Apply</button>
      </form>
      {message && <p role="status" className="text-xs text-neutral-500">{message}</p>}
    </div>
  );
}
