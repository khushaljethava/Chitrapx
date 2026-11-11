import Link from "next/link";
import { redirect } from "next/navigation";
import { CtaBand, PublicHeader } from "@/components/Shell.tsx";
import { SiteFooter } from "@/components/SiteFooter.tsx";
import { currentUser } from "@/server/context.ts";

const SHOTS = [
  { title: "Track every habit", bg: "from-indigo-500 to-indigo-800", tilt: "-rotate-6 translate-y-6" },
  { title: "Plan in seconds", bg: "from-coral-500 to-pink-600", tilt: "-rotate-3 translate-y-2" },
  { title: "Your day, sorted", bg: "from-neutral-800 to-neutral-950", tilt: "z-10 scale-110" },
  { title: "Share with friends", bg: "from-emerald-400 to-teal-700", tilt: "rotate-3 translate-y-2" },
  { title: "Works offline", bg: "from-amber-400 to-orange-600", tilt: "rotate-6 translate-y-6" },
];

const STEPS = [
  ["Upload your screens", "Drop in raw app screenshots for iPhone, iPad and Android."],
  ["AI designs and writes", "Layouts, headlines and translations into 30+ languages."],
  ["Finish and export", "Tweak anything in a real editor, then export store-ready sizes."],
];

const FEATURES = [
  ["AI layouts", "Full sets laid out in your brand colors, not one-off templates."],
  ["Translations", "Every caption localized, with a glossary that keeps your terms."],
  ["A real editor", "Layers, fonts, device frames and gradients, all on one canvas."],
  ["Live co-editing", "Invite your team and edit the same set together."],
  ["Feature graphics", "Google Play feature graphics and promo art from the same doc."],
  ["Store-ready export", "Every required App Store and Play size in one click."],
];

export default async function Home() {
  if (await currentUser()) redirect("/dashboard");
  return (
    <>
      <PublicHeader />

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 text-center sm:pt-24">
          <span className="chip normal-case tracking-normal"><span className="mr-1 text-coral-500">✦</span>AI store screenshots for App Store and Google Play</span>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-bold leading-[1.05] sm:text-7xl">Store screenshots that sell</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
            Upload your app screens. Chitrapx designs, writes and translates the full App Store and Google Play set, and you finish it in a real editor.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/login" className="btn px-6 py-3 text-base">Get started free</Link>
            <a href="#how" className="btn-ghost px-6 py-3 text-base">See how it works</a>
          </div>

          <div aria-hidden className="-mx-4 mt-20 flex items-end justify-center gap-3 overflow-x-clip py-8 sm:gap-5">
            {SHOTS.map((s) => (
              <div key={s.title} className={`w-28 shrink-0 rounded-[1.75rem] bg-gradient-to-b ${s.bg} p-2 sm:w-40 ${s.tilt}`}>
                <p className="px-2 pt-3 text-left font-display text-sm font-bold leading-tight text-white sm:text-base">{s.title}</p>
                <div className="mt-3 aspect-[9/16] rounded-[1.25rem] border border-white/20 bg-white/15" />
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto mt-32 max-w-6xl px-4">
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="card">
                <span className="grid size-8 place-items-center rounded-full bg-indigo-50 font-display font-bold text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">{i + 1}</span>
                <h2 className="mt-4 text-lg font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto mt-24 max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">Everything a store listing needs</h2>
          <ul className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-neutral-800 dark:bg-neutral-800">
            {FEATURES.map(([title, body]) => (
              <li key={title} className="bg-white p-6 dark:bg-neutral-900">
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{body}</p>
              </li>
            ))}
          </ul>
        </section>

      </main>
      <div className="mt-24"><CtaBand title="Ship your listing this afternoon" /></div>
      <SiteFooter dark />
    </>
  );
}
