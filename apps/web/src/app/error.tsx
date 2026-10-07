"use client";

import Link from "next/link";
import { Notice, NoticePage, icon } from "@/components/Notice.tsx";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <NoticePage>
      <Notice tone="coral" title="Something went wrong" icon={icon("M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z")}
        body={<>
          An unexpected error stopped this page. Try again, or head back to the dashboard.
          {error.digest && <span className="mt-3 block font-mono text-xs text-neutral-400">Error ID: {error.digest}</span>}
        </>}>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="btn" onClick={() => retry()}>Try again</button>
          <Link href="/dashboard" className="btn-ghost">Go to dashboard</Link>
        </div>
      </Notice>
    </NoticePage>
  );
}
