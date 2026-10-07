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
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-white/80 backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="font-display text-lg font-bold tracking-tight">Chitrapx</Link>
            {workspaces.length > 1 && <span className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />}
            <WorkspaceSwitcher current={ctx.workspaceId} workspaces={workspaces.map(({ id, name, role }) => ({ id, name, role }))} />
          </div>
          <nav className="flex items-center gap-1">
            <Link href="/dashboard" className="nav-link">Apps</Link>
            <Link href="/dashboard/team" className="nav-link">Team</Link>
            <Link href="/dashboard/community" className="nav-link">Community</Link>
            <span className="mx-1"><NotificationsBell /></span>
            <Link href="/dashboard/billing" title="Plan and credits"><CreditsBadge balance={credits} /></Link>
            <form action="/auth/signout" method="post"><button className="nav-link">Sign out</button></form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
