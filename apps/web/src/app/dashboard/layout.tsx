import Link from "next/link";
import { balance, db } from "@chitrapx/db";
import { NotificationsBell } from "@/components/Comments.tsx";
import { CreditsBadge } from "@/components/CreditsBadge.tsx";
import { SiteFooter } from "@/components/SiteFooter.tsx";
import { AccessRemoved, WorkspaceSwitcher } from "@/components/Workspaces.tsx";
import { listWorkspaces, requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext().catch((e) => { if (e instanceof HttpError && e.code === "access_removed") return null; throw e; });
  if (!ctx) return <AccessRemoved />;
  const [credits, workspaces] = await Promise.all([balance(db, ctx.workspaceId), listWorkspaces(ctx.userId)]);
  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="font-semibold">Chitrapx</Link>
            <WorkspaceSwitcher current={ctx.workspaceId} workspaces={workspaces.map(({ id, name, role }) => ({ id, name, role }))} />
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell />
            <Link href="/dashboard/team" className="text-sm hover:underline">Team</Link>
            <Link href="/dashboard/community" className="text-sm hover:underline">Community</Link>
            <Link href="/dashboard/billing" title="Plan and credits"><CreditsBadge balance={credits} /></Link>
            <form action="/auth/signout" method="post"><button className="btn-ghost">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
