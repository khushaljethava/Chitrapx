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
      <Link href="/dashboard/community" className="text-sm text-neutral-500 hover:underline">Community templates</Link>
      <h1 className="text-2xl font-semibold">Review reports</h1>
      <p className="text-sm text-neutral-500">Hidden posts and posts with reports. Restoring clears the reports; removing hides the post from everyone. Both are logged.</p>
      <ModerationQueue items={items} />
    </>
  );
}
