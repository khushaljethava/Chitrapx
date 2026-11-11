import Link from "next/link";
import { balance, db } from "@chitrapx/db";
import { NotificationsBell } from "@/components/Comments.tsx";
import { CreditsBadge } from "@/components/CreditsBadge.tsx";
import { AccountMenu, NavTabs } from "@/components/Shell.tsx";
import { SiteFooter } from "@/components/SiteFooter.tsx";
import { Logo } from "@/components/ui.tsx";
import { NoticePage } from "@/components/Notice.tsx";
import { AccessRemoved, WorkspaceSwitcher } from "@/components/Workspaces.tsx";
import { listWorkspaces, requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext().catch((e) => { if (e instanceof HttpError && e.code === "access_removed") return null; throw e; });
  if (!ctx) return <NoticePage><AccessRemoved /></NoticePage>;
  const [credits, workspaces] = await Promise.all([balance(db, ctx.workspaceId), listWorkspaces(ctx.userId)]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Logo href="/dashboard" />
          <WorkspaceSwitcher current={ctx.workspaceId} workspaces={workspaces.map(({ id, name, role }) => ({ id, name, role }))} />
          <div className="hidden h-full min-w-0 flex-1 md:block"><NavTabs /></div>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <Link href="/dashboard/billing" title="Plan and credits" className="hidden rounded-full sm:inline-flex"><CreditsBadge balance={credits} /></Link>
            <NotificationsBell />
            <AccountMenu />
          </div>
        </div>
        {/* Phones: the tabs get their own row and scroll inside it instead of widening the page. */}
        <div className="h-11 border-t border-line px-4 md:hidden"><NavTabs /></div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-10 px-4 py-10 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
