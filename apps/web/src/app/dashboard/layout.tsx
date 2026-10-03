import Link from "next/link";
import { balance, db } from "@chitrapx/db";
import { CreditsBadge } from "@/components/CreditsBadge.tsx";
import { requireContext } from "@/server/context.ts";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const credits = await balance(db, ctx.workspaceId);
  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="font-semibold">Chitrapx</Link>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/billing" title="Plan and credits"><CreditsBadge balance={credits} /></Link>
            <form action="/auth/signout" method="post"><button className="btn-ghost">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">{children}</main>
    </div>
  );
}
