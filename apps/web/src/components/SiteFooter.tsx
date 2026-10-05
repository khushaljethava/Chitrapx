"use client";

import Link from "next/link";
import { analyticsEnabled } from "@/lib/consent.ts";
import { COOKIE_SETTINGS_EVENT } from "./AnalyticsConsent.tsx";

/** Changelog, privacy and (when analytics is on) a way to change the cookie choice later. */
export function SiteFooter() {
  return (
    <footer className="mx-auto flex max-w-5xl flex-wrap justify-center gap-4 px-4 py-6 text-sm text-neutral-500">
      <Link href="/changelog" className="hover:underline">Changelog</Link>
      <Link href="/privacy" className="hover:underline">Privacy</Link>
      {analyticsEnabled() && (
        <button type="button" className="hover:underline" onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}>Cookie settings</button>
      )}
    </footer>
  );
}
