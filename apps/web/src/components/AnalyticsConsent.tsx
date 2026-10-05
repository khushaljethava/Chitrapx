"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { analyticsEnabled, consentCookie, effectiveConsent, privacySignal, type ConsentChoice } from "@/lib/consent.ts";
import { setTrackingEnabled, track } from "@/lib/track.ts";

/** Fired by the "Cookie settings" link to reopen the choice. */
export const COOKIE_SETTINGS_EVENT = "chitrapx:cookie-settings";

const nav = () => navigator as Navigator & { globalPrivacyControl?: boolean };

/**
 * The consent banner and the page-view counter. Nothing is sent until the visitor accepts;
 * Do Not Track or Global Privacy Control counts as no. Renders nothing when analytics is off.
 */
export function AnalyticsConsent() {
  const on = analyticsEnabled();
  const [state, setState] = useState<ConsentChoice | "ask" | null>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const signedUp = useRef(false);

  useEffect(() => {
    if (!on) return;
    const now = effectiveConsent(document.cookie, nav());
    setState(now);
    setOpen(now === "ask");
    const reopen = () => setOpen(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
  }, [on]);

  useEffect(() => { setTrackingEnabled(state === "granted"); }, [state]);

  useEffect(() => {
    if (state !== "granted") return;
    track("page_view");
    if (!signedUp.current && new URLSearchParams(window.location.search).get("welcome") === "1") { signedUp.current = true; track("sign_up"); }
  }, [state, pathname]);

  if (!on || !open || state === null) return null;
  const blocked = privacySignal(nav());

  function choose(choice: ConsentChoice) {
    document.cookie = consentCookie(choice, undefined, window.location.protocol === "https:");
    setState(choice);
    setOpen(false);
  }

  return (
    <div role="region" aria-label="Cookie settings" className="fixed inset-x-0 bottom-0 z-[70] border-t border-neutral-200 bg-white p-4 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1">
          {blocked
            ? "Your browser asks sites not to track you, so Chitrapx counts nothing. Sign-in cookies are always on because the app needs them."
            : "May Chitrapx count page views and a few actions, like starting an export? The counts stay on our own servers, with no cookies, no third parties and nothing that identifies you. Sign-in cookies are always on because the app needs them."}
          {" "}<Link href="/privacy" className="text-indigo-600 hover:underline">Privacy</Link>
        </p>
        <div className="flex gap-2">
          {blocked ? (
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Close</button>
          ) : (
            <>
              <button type="button" className="btn-ghost min-w-24 border border-neutral-300 dark:border-neutral-700" onClick={() => choose("denied")}>Reject</button>
              <button type="button" className="btn min-w-24" onClick={() => choose("granted")}>Accept</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
