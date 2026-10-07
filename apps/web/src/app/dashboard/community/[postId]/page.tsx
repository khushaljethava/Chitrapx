import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunityPostView } from "@/components/Community.tsx";
import { listApps } from "@/server/apps.ts";
import { getPost } from "@/server/community.ts";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { isStaff } from "@/server/staff.ts";
import { appStorage } from "@/server/storage.ts";

/** A hidden post is a 404 here too for anyone but its author and staff; a removed one for everyone. */
export default async function CommunityPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const ctx = await requireContext();
  const post = await getPost(ctx, appStorage(), (await params).postId, await isStaff())
    .catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const apps = await listApps(ctx);
  return (
    <>
      <nav aria-label="Breadcrumb" className="truncate text-sm text-neutral-500">
        <Link href="/dashboard/community" className="hover:text-neutral-900 dark:hover:text-neutral-100">Community templates</Link>
        <span className="mx-1.5">/</span><span className="text-neutral-900 dark:text-neutral-100">{post.title}</span>
      </nav>
      <CommunityPostView post={post} apps={apps.map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
