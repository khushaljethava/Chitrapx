import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { CtaBand, PublicHeader } from "@/components/Shell.tsx";
import { SiteFooter } from "@/components/SiteFooter.tsx";
import { parseChangelog, type Inline } from "@/lib/changelog.ts";

// Prerendered at build time: CHANGELOG.md is read once by the build, never at request time.
export const dynamic = "force-static";

const TITLE = "Changelog · Chitrapx";
const DESCRIPTION = "What's new in Chitrapx: every release of the App Store and Google Play screenshot designer.";
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", url: "/changelog" },
};

/** Repo root CHANGELOG.md; the build runs in apps/web. */
const releases = () => parseChangelog(readFileSync(join(process.cwd(), "..", "..", "CHANGELOG.md"), "utf8"));

/** Text only: React escapes every string, so markup in the file can never run. */
function Text({ parts }: { parts: Inline[] }) {
  return parts.map((p, i) => (p.code ? <code key={i} className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[0.85em] dark:bg-neutral-800">{p.text}</code>
    : p.bold ? <strong key={i} className="font-semibold text-neutral-900 dark:text-neutral-100">{p.text}</strong> : <span key={i}>{p.text}</span>));
}

export default function ChangelogPage() {
  return (
    <>
    <PublicHeader />
    <main className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <header className="mb-12 space-y-3">
        <h1 className="text-4xl font-bold sm:text-5xl">Changelog</h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">What changed, newest first.</p>
      </header>
      <ol className="relative space-y-12 border-l border-neutral-200 dark:border-neutral-800">
      {releases().map((r) => (
        <li key={r.version} className="relative pl-6 sm:pl-8">
        <span aria-hidden className={`absolute -left-[6px] top-2.5 size-[11px] rounded-full ring-4 ring-neutral-50 dark:ring-neutral-950 ${r.version === "Unreleased" ? "border-2 border-indigo-600 bg-neutral-50 dark:bg-neutral-950" : "bg-indigo-600"}`} />
        <section className="space-y-4" aria-labelledby={`v-${r.version}`}>
          <h2 id={`v-${r.version}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold">
            {r.version === "Unreleased" ? "Coming next" : r.version}
            {r.date && <time dateTime={r.date} className="chip font-sans normal-case tracking-normal tabular-nums">{r.date}</time>}
          </h2>
          {r.sections.map((s, i) => (
            <div key={i} className="space-y-2">
              {s.title && <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{s.title}</h3>}
              <ul className="list-disc space-y-1.5 pl-5 leading-relaxed text-neutral-700 marker:text-neutral-400 dark:text-neutral-300">
                {s.items.map((item, k) => <li key={k}><Text parts={item} /></li>)}
              </ul>
            </div>
          ))}
        </section>
        </li>
      ))}
      </ol>
    </main>
    <CtaBand />
    <SiteFooter dark />
    </>
  );
}
