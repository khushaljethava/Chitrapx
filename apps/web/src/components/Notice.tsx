import Link from "next/link";

/** Centered message card for Access removed and error pages (Stitch "Access removed" design). */
export function Notice({ icon, tone = "indigo", title, body, children }: { icon: React.ReactNode; tone?: "indigo" | "coral"; title: string; body: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card w-full max-w-[440px] p-8 text-center sm:p-10">
      <div aria-hidden className={`mx-auto mb-5 flex size-14 items-center justify-center rounded-full ring-4 ${tone === "coral" ? "bg-coral-500/10 text-coral-600 ring-coral-500/5" : "bg-indigo-600/10 text-indigo-600 ring-indigo-600/5 dark:text-indigo-400"}`}>{icon}</div>
      <h1 className="mb-2 text-2xl font-bold">{title}</h1>
      <div className="mx-auto mb-8 max-w-xs text-sm leading-relaxed text-neutral-500">{body}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Full-screen page around a Notice: wordmark on top, content centered. */
export function NoticePage({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <Link href="/" className="font-display text-lg font-bold tracking-tight sm:mt-4">Chitrapx</Link>
      <div className="flex w-full flex-1 items-center justify-center py-8">{children}</div>
    </main>
  );
}

export const icon = (d: string) => (
  <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
