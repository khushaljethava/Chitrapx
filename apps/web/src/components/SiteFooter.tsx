"use client";

import Link from "next/link";
import { analyticsEnabled } from "@/lib/consent.ts";
import { COOKIE_SETTINGS_EVENT } from "./AnalyticsConsent.tsx";

/** Wordmark, copyright, and changelog, privacy and (when analytics is on) a way to change the cookie choice later. `dark` sits under the CTA band. */
export function SiteFooter({ dark = false }: { dark?: boolean }) {
  const link = dark ? "text-white/55 transition hover:text-white" : "text-muted transition hover:text-ink";
  return (
    <footer className={`border-t ${dark ? "border-white/10 bg-night text-white" : "border-line"}`}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className={`flex items-center gap-3 text-xs ${dark ? "text-white/55" : "text-muted"}`}>
          <span className={`font-display text-sm font-bold tracking-[-0.02em] ${dark ? "text-white" : "text-ink"}`}>Chitrapx</span>
          © {new Date().getFullYear()} Chitrapx. Store screenshots that sell.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <Link href="/changelog" className={link}>Changelog</Link>
          <Link href="/privacy" className={link}>Privacy</Link>
          {analyticsEnabled() && (
            <button type="button" className={link} onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}>Cookie settings</button>
          )}
        </nav>
      </div>
    </footer>
  );
}
