"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MemberRole, Plan } from "@chitrapx/db";
import { api, ApiError } from "@/server/api.ts";
import { assignableRoles, ROLE_HINT, ROLE_LABEL, seatBanner } from "./teamModel.ts";

type Member = { userId: string; email: string; name: string | null; role: MemberRole; joinedAt: string; you: boolean };
type Invite = { id: string; email: string; role: MemberRole; expiresAt: string };
type Seats = { used: number; members: number; pending: number; max: number; over: boolean };

/** Members, roles, invite links and seats for the current workspace (SP15). */
export function TeamPanel({ me, plan, members, invites, seats }: { me: MemberRole; plan: Plan; members: Member[]; invites: Invite[]; seats: Seats }) {
  const router = useRouter();
  const manage = me === "owner" || me === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [error, setError] = useState<{ message: string; upgrade?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const banner = seatBanner(seats, plan);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, upgrade: e.code === "plan_limit" } : { message: "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ url: string; email: string }>("/api/invites", "POST", { email, role });
      setLink({ url: res.url, email: res.email });
      setEmail("");
    });
  };

  return (
    <div className="space-y-6">
      {banner && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {banner} <Link href="/dashboard/billing" className="underline">Billing</Link>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error.message} {error.upgrade && <Link href="/dashboard/billing" className="underline">Upgrade</Link>}
        </p>
      )}

      <section className="card space-y-3">
        <h2 className="font-medium">Members <span className="text-sm text-neutral-500">· {seats.members} of {seats.max} seat{seats.max === 1 ? "" : "s"} used{seats.pending ? `, ${seats.pending} pending` : ""}</span></h2>
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {members.map((m) => {
            const options = assignableRoles(me, m);
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium">{m.name || m.email}{m.you && <span className="text-neutral-500"> (you)</span>}</p>
                  <p className="text-xs text-neutral-500">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {options.length ? (
                    <select aria-label={`Role for ${m.email}`} className="input w-auto" value={m.role} disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value as MemberRole;
                        if (next === "owner" && !confirm(`Make ${m.email} the owner? You will become an admin.`)) return;
                        void run(() => api(`/api/members/${m.userId}`, "PATCH", { role: next }));
                      }}>
                      {!options.includes(m.role) && <option value={m.role}>{ROLE_LABEL[m.role]}</option>}
                      {options.map((r) => <option key={r} value={r}>{r === "owner" ? "Owner (transfer)" : ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : <span className="text-sm text-neutral-600 dark:text-neutral-400" title={ROLE_HINT[m.role]}>{ROLE_LABEL[m.role]}</span>}
                  {m.you && m.role !== "owner" && (
                    <button className="btn-danger" disabled={busy} onClick={() => confirm("Leave this workspace?") && void run(async () => {
                      await api(`/api/members/${m.userId}`, "DELETE");
                      window.location.assign("/dashboard");
                    })}>Leave</button>
                  )}
                  {!m.you && manage && m.role !== "owner" && (
                    <button className="btn-danger" disabled={busy} onClick={() => confirm(`Remove ${m.email}? They lose access at once.`) && void run(() => api(`/api/members/${m.userId}`, "DELETE"))}>Remove</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {manage && (
        <section className="card space-y-3">
          <h2 className="font-medium">Invite someone</h2>
          <p className="text-sm text-neutral-500">We do not send email. You get a link to send yourself; it works once, for that email address, for 7 days.</p>
          <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
            <div className="min-w-60 flex-1">
              <label className="label" htmlFor="invite-email">Email</label>
              <input id="invite-email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="invite-role">Role</label>
              <select id="invite-role" className="input w-auto" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                {(["admin", "editor", "viewer"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} · {ROLE_HINT[r]}</option>)}
              </select>
            </div>
            <button className="btn" disabled={busy}>Create invite link</button>
          </form>
          {link && (
            <div className="space-y-1 rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-800">
              <p>Send this link to <strong>{link.email}</strong>. It is shown only now.</p>
              <div className="flex gap-2">
                <input readOnly aria-label="Invite link" className="input font-mono text-xs" value={link.url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(link.url)}>Copy</button>
              </div>
            </div>
          )}
          {invites.length > 0 && (
            <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <span>{i.email} · {ROLE_LABEL[i.role]} · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                  <button className="btn-danger" disabled={busy} onClick={() => void run(() => api(`/api/invites/${i.id}`, "DELETE"))}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
