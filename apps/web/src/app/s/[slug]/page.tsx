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
    return <main className="mx-auto max-w-md px-4 py-24 text-center"><Link href="/" className="font-display text-lg font-bold tracking-tight">Chitrapx</Link><p className="card mt-6 text-neutral-500">Too many requests. Try again in a minute.</p></main>;
  }
  const { slug } = await params;
  const view = await sharedView(slug).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const user = await currentUser();
  const ctx = user ? await contextFor(user, await chosenWorkspace()).catch(() => null) : null;
  const apps = ctx ? (await listApps(ctx)).map(({ id, name }) => ({ id, name })) : [];
  return (
    <>
    <header className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">Chitrapx</Link>
      </div>
    </header>
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="chip normal-case tracking-normal">Shared with Chitrapx · view only</p>
          <h1 className="break-words text-3xl font-bold sm:text-4xl">{view.name}</h1>
        </div>
        {view.allowDuplicate && <DuplicateShared slug={slug} signedIn={!!user} apps={apps} />}
      </div>
      <ProjectBoards doc={view.doc} assetUrls={view.assetUrls} extras={view.extras} />
      <p className="border-t border-neutral-200 pt-6 text-center text-sm text-neutral-500 dark:border-neutral-800">Made with <Link href="/" className="font-display font-bold text-neutral-900 hover:text-indigo-600 dark:text-neutral-100 dark:hover:text-indigo-400">Chitrapx</Link>.</p>
    </main>
    </>
  );
}
