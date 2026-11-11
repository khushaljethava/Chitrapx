import type { Metadata } from "next";
import { CtaBand, PublicHeader } from "@/components/Shell.tsx";
import { SiteFooter } from "@/components/SiteFooter.tsx";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy · Chitrapx",
  description: "What Chitrapx stores, which cookies it sets and how usage counting works.",
};

export default function PrivacyPage() {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-2xl space-y-10 px-4 py-12 leading-relaxed text-neutral-700 sm:py-16 dark:text-neutral-300 [&_code]:rounded-md [&_code]:bg-neutral-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-neutral-800 [&_strong]:font-semibold [&_strong]:text-neutral-900 dark:[&_strong]:text-neutral-100">
        <h1 className="text-4xl font-bold text-neutral-900 sm:text-5xl dark:text-neutral-100">Privacy</h1>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Cookies</h2>
          <p>
            <strong>Strictly necessary:</strong> sign-in cookies set by Supabase, the service Chitrapx uses for accounts, keep you
            signed in. The app does not work without them, so they are never part of the cookie choice.
          </p>
          <p>
            <strong>Your choice:</strong> one cookie, <code>chitrapx_consent</code>, remembers whether you allowed usage counting. It
            holds only that answer and lasts 180 days. Change it any time with &ldquo;Cookie settings&rdquo; at the bottom of the page.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Usage counting</h2>
          <p>
            Only if you accept, Chitrapx counts page views and a few actions: signing up, creating a project, starting an export,
            and sharing or using a community template. Chitrapx itself is the only processor: the counts go to Chitrapx&apos;s own
            database, never to an analytics company or advertiser, and no tracking script or tracking cookie is loaded.
          </p>
          <p>
            Each count holds the action&apos;s name, the page path with any ids removed (for example <code>/editor/:id</code>), at most
            one coarse detail such as the export format, and the time. It holds no account, email, name, project content, file name,
            IP address, browser details or referrer, so it cannot be traced back to you.
          </p>
          <p>If your browser sends Do Not Track or Global Privacy Control, nothing is counted and you are not asked.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Your projects and files</h2>
          <p>
            Your projects, screenshots and exports are stored for your workspace only. A project becomes visible to others only
            when you share it to the community feed, and you can delete a shared post at any time.
          </p>
        </section>
      </main>
      <CtaBand />
      <SiteFooter dark />
    </>
  );
}
