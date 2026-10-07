import Link from "next/link";
import { NoticePage } from "@/components/Notice.tsx";

export const metadata = { title: "Page not found · Chitrapx" };

export default function NotFound() {
  return (
    <NoticePage>
      <div className="max-w-md text-center">
        {/* The zero is an empty phone frame (Stitch 404 design). */}
        <p aria-hidden className="flex items-center justify-center font-display text-8xl font-bold tracking-tighter sm:text-9xl">
          4<span className="mx-2 inline-block h-20 w-12 -rotate-12 rounded-2xl border-[6px] border-indigo-600 sm:h-28 sm:w-16 dark:border-indigo-400" />4
        </p>
        <h1 className="mt-8 text-2xl font-bold">This page isn&apos;t here</h1>
        <p className="mt-2 text-sm text-neutral-500">The link may be old, or the page was moved or deleted.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/dashboard" className="btn">Go to dashboard</Link>
          <Link href="/" className="btn-ghost">Back to home</Link>
        </div>
      </div>
    </NoticePage>
  );
}
