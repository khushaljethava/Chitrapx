import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceActions } from "@/components/Admin.tsx";
import { adminStats, adminWorkspaces, failedJobs, recentPayments, requireAdmin } from "@/server/admin.ts";
import { currentUser } from "@/server/context.ts";

export const metadata = { title: "Admin · Chitrapx", robots: { index: false } };

const money = (amount: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(amount / 100);
const date = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" }) : "");

/** ADMIN_EMAILS only: signed-out visitors go to the code login, every other account gets a 404. */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  if (!(await currentUser())) redirect("/admin/login");
  await requireAdmin().catch(() => notFound());
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const [s, payments, workspaces, failed] = await Promise.all([adminStats(), recentPayments(), adminWorkspaces(q), failedJobs()]);
  const stats: Array<[string, string | number]> = [
    ["Users", s.users], ["New users, 7 days", s.users7], ["New users, 30 days", s.users30], ["Workspaces", s.workspaces],
    ["Paid payments", s.payments], ["Pro subscriptions", s.subscriptions.pro ?? 0], ["Studio subscriptions", s.subscriptions.studio ?? 0],
    ["Jobs failed, 24 h", `${s.jobs24h.failed ?? 0} of ${Object.values(s.jobs24h).reduce((a, b) => a + b, 0)}`],
  ];
  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <span className="font-display text-lg font-bold">Chitrapx admin</span>
          <nav className="flex items-center gap-1">
            <Link href="/dashboard" className="nav-link">App</Link>
            <form action="/auth/signout" method="post"><button className="nav-link">Sign out</button></form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-10">
        <section aria-labelledby="overview" className="space-y-4">
          <h1 id="overview" className="text-3xl font-bold">Overview</h1>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map(([label, value]) => (
              <div key={label} className="card p-4">
                <dt className="text-xs text-neutral-500">{label}</dt>
                <dd className="mt-1 font-display text-2xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-neutral-500">
            Revenue from credit packs: {s.revenue.length ? s.revenue.map((r) => money(r.amount, r.currency)).join(" · ") : "none yet"}.
            Subscription revenue is in the Razorpay dashboard.
          </p>
        </section>

        <section aria-labelledby="workspaces" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="workspaces" className="text-xl font-bold">Workspaces</h2>
            <form className="flex gap-2" role="search">
              <label htmlFor="q" className="sr-only">Search by owner email or workspace name</label>
              <input id="q" name="q" defaultValue={q} placeholder="Owner email or workspace" className="input w-64 max-w-full" />
              <button className="btn">Search</button>
            </form>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-neutral-500"><tr><th className="p-3">Workspace</th><th className="p-3">Owner</th><th className="p-3">Created</th><th className="p-3">Credits</th><th className="p-3">Plan and credits</th></tr></thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {workspaces.map((w) => (
                  <tr key={w.id} className="align-top">
                    <td className="p-3 font-medium">{w.name}</td>
                    <td className="p-3">{w.email}</td>
                    <td className="p-3 whitespace-nowrap">{date(w.createdAt)}</td>
                    <td className="p-3 tabular-nums">{w.credits}</td>
                    <td className="p-3"><WorkspaceActions workspaceId={w.id} plan={w.plan} /></td>
                  </tr>
                ))}
                {!workspaces.length && <tr><td colSpan={5} className="p-3 text-neutral-500">No workspaces match.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="payments" className="space-y-4">
          <h2 id="payments" className="text-xl font-bold">Recent payments</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-neutral-500"><tr><th className="p-3">Paid</th><th className="p-3">Workspace</th><th className="p-3">Owner</th><th className="p-3">Pack</th><th className="p-3">Amount</th></tr></thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="p-3 whitespace-nowrap">{date(p.paidAt)}</td><td className="p-3">{p.workspace}</td><td className="p-3">{p.email}</td>
                    <td className="p-3">{p.pack} ({p.credits} credits)</td><td className="p-3 tabular-nums">{money(p.amount, p.currency)}</td>
                  </tr>
                ))}
                {!payments.length && <tr><td colSpan={5} className="p-3 text-neutral-500">No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="failed" className="space-y-4">
          <h2 id="failed" className="text-xl font-bold">Failed jobs, last 7 days</h2>
          <ul className="card divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {failed.map((j) => <li key={j.id} className="p-3"><span className="font-medium">{j.type}</span> · {date(j.createdAt)} · <span className="text-neutral-500">{j.error}</span></li>)}
            {!failed.length && <li className="p-3 text-neutral-500">None.</li>}
          </ul>
        </section>
      </main>
    </div>
  );
}
