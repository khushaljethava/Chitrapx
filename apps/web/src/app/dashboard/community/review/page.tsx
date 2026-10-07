import Link from "next/link";
import { notFound } from "next/navigation";
import { ModerationQueue } from "@/components/Community.tsx";
import { moderationQueue } from "@/server/community.ts";
import { requireContext } from "@/server/context.ts";
import { isStaff } from "@/server/staff.ts";

/** Staff only (STAFF_EMAILS); everyone else gets 404. */
export default async function ReviewPage() {
  const ctx = await requireContext();
  const staff = await isStaff();
  if (!staff) notFound();
  const items = await moderationQueue(ctx, staff);
  return (
    <>
      <div className="space-y-4">
        <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
          <Link href="/dashboard/community" className="hover:text-neutral-900 dark:hover:text-neutral-100">Community templates</Link>
          <span className="mx-1.5">/</span><span className="text-neutral-900 dark:text-neutral-100">Review reports</span>
        </nav>
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Review reports</h1>
          <p className="text-sm text-neutral-500">Hidden posts and posts with reports. Restoring clears the reports; removing hides the post from everyone. Both are logged.</p>
        </div>
      </div>
      <ModerationQueue items={items} />
    </>
  );
}
