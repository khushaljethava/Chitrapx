import Link from "next/link";
import { CommunityFeed } from "@/components/Community.tsx";
import { listApps } from "@/server/apps.ts";
import { listPosts } from "@/server/community.ts";
import { requireContext } from "@/server/context.ts";
import { isStaff } from "@/server/staff.ts";
import { appStorage } from "@/server/storage.ts";

export default async function CommunityPage() {
  const ctx = await requireContext();
  const [initial, apps, staff] = await Promise.all([listPosts(ctx, appStorage(), {}), listApps(ctx), isStaff()]);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Community templates</h1>
          <p className="text-sm text-neutral-500">Screenshot sets other people shared. Use one to start a project of your own.</p>
        </div>
        {staff && <Link href="/dashboard/community/review" className="btn-ghost">Review reports</Link>}
      </div>
      <CommunityFeed initial={initial} apps={apps.map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
