import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ProjectBoards } from "@/components/ProjectBoards.tsx";
import { DuplicateShared } from "@/components/SharePanel.tsx";
import { CtaBand, PublicHeader } from "@/components/Shell.tsx";
import { SiteFooter } from "@/components/SiteFooter.tsx";
import { Logo } from "@/components/ui.tsx";
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
    return <main className="mx-auto max-w-md px-4 py-24 text-center"><Logo /><p className="card mt-6 text-muted">Too many requests. Try again in a minute.</p></main>;
  }
  const { slug } = await params;
  const view = await sharedView(slug).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const user = await currentUser();
  const ctx = user ? await contextFor(user, await chosenWorkspace()).catch(() => null) : null;
  const apps = ctx ? (await listApps(ctx)).map(({ id, name }) => ({ id, name })) : [];
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader>
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <span aria-hidden className="text-ink/25">/</span>
          <span className="truncate text-sm text-muted">{view.name}</span>
        </div>
        <Link href="/login" className="btn shrink-0"><span className="hidden sm:inline">Made with Chitrapx —</span> Try free</Link>
      </PublicHeader>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-10 px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-8">
          <div className="min-w-0 space-y-3">
            <p className="pill-primary">Shared set · view only</p>
            <h1 className="break-words text-3xl font-extrabold sm:text-5xl">{view.name}</h1>
          </div>
          {view.allowDuplicate && <DuplicateShared slug={slug} signedIn={!!user} apps={apps} />}
        </div>
        <ProjectBoards doc={view.doc} assetUrls={view.assetUrls} extras={view.extras} />
      </main>
      <CtaBand />
      <SiteFooter dark />
    </div>
  );
}
