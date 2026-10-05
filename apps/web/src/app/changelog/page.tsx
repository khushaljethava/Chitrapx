import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
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
  return parts.map((p, i) => (p.code ? <code key={i} className="rounded bg-neutral-100 px-1 text-sm dark:bg-neutral-800">{p.text}</code>
    : p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>));
}

export default function ChangelogPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-10 px-4 py-12">
      <header className="space-y-2">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">Chitrapx</Link>
        <h1 className="text-3xl font-bold tracking-tight">Changelog</h1>
        <p className="text-neutral-600 dark:text-neutral-400">What changed, newest first.</p>
      </header>
      {releases().map((r) => (
        <section key={r.version} className="space-y-3" aria-labelledby={`v-${r.version}`}>
          <h2 id={`v-${r.version}`} className="flex items-baseline gap-3 text-xl font-semibold">
            {r.version === "Unreleased" ? "Coming next" : r.version}
            {r.date && <time dateTime={r.date} className="text-sm font-normal text-neutral-500">{r.date}</time>}
          </h2>
          {r.sections.map((s, i) => (
            <div key={i} className="space-y-1">
              {s.title && <h3 className="label">{s.title}</h3>}
              <ul className="list-disc space-y-1 pl-5">
                {s.items.map((item, k) => <li key={k}><Text parts={item} /></li>)}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
