import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ProjectBoards } from "@/components/ProjectBoards.tsx";
import { DuplicateShared } from "@/components/SharePanel.tsx";
import { clientKey } from "@/lib/rateLimit.ts";
import { listApps } from "@/server/apps.ts";
import { chosenWorkspace, contextFor, currentUser } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { sharedView, viewLimit } from "@/server/shares.ts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared project · Chitrapx", robots: { index: false, follow: false } };

/** SP15: a read-only preview anyone with the link can open. No editor, no comments, nothing private. */
export default async function SharedPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!viewLimit(clientKey(await headers()))) {
    return <main className="mx-auto max-w-md px-4 py-16 text-center text-neutral-500">Too many requests. Try again in a minute.</main>;
  }
  const { slug } = await params;
  const view = await sharedView(slug).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const user = await currentUser();
  const ctx = user ? await contextFor(user, await chosenWorkspace()).catch(() => null) : null;
  const apps = ctx ? (await listApps(ctx)).map(({ id, name }) => ({ id, name })) : [];
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">Shared with Chitrapx · view only</p>
          <h1 className="text-2xl font-semibold">{view.name}</h1>
        </div>
        {view.allowDuplicate && <DuplicateShared slug={slug} signedIn={!!user} apps={apps} />}
      </div>
      <ProjectBoards doc={view.doc} assetUrls={view.assetUrls} extras={view.extras} />
      <p className="text-sm text-neutral-500">Made with <Link href="/" className="underline">Chitrapx</Link>.</p>
    </main>
  );
}
