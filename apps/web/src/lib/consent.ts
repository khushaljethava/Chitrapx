/**
 * Analytics consent, stored in one first-party cookie: `chitrapx_consent=<version>.<granted|denied>`.
 * Bumping CONSENT_VERSION asks everyone again. Do Not Track or Global Privacy Control means "denied"
 * without asking. Supabase's session cookies are strictly necessary and never gated by this.
 */
export const CONSENT_VERSION = 1;
export const CONSENT_COOKIE = "chitrapx_consent";
const MAX_AGE_S = 180 * 24 * 60 * 60;

export type ConsentChoice = "granted" | "denied";

/** True when the build turned first-party analytics on; off means no banner, no events. */
export const analyticsEnabled = () => process.env.NEXT_PUBLIC_ANALYTICS === "on";

/** The stored choice for `version`, or null (none yet, an older version, or a garbled value). */
export function parseConsent(cookieHeader: string, version = CONSENT_VERSION): ConsentChoice | null {
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== CONSENT_COOKIE) continue;
    const m = /^(\d+)\.(granted|denied)$/.exec(rest.join("="));
    return m && Number(m[1]) === version ? (m[2] as ConsentChoice) : null;
  }
  return null;
}

/** A Set-Cookie style string for `document.cookie`. */
export function consentCookie(choice: ConsentChoice, version = CONSENT_VERSION, secure = false): string {
  return `${CONSENT_COOKIE}=${version}.${choice}; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

type PrivacyNavigator = { doNotTrack?: string | null; globalPrivacyControl?: boolean };

/** The browser asks not to be tracked (DNT or GPC). */
export function privacySignal(nav: PrivacyNavigator): boolean {
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/** What to do now: a stored choice, "denied" for DNT/GPC, or "ask". */
export function effectiveConsent(cookieHeader: string, nav: PrivacyNavigator, version = CONSENT_VERSION): ConsentChoice | "ask" {
  if (privacySignal(nav)) return "denied";
  return parseConsent(cookieHeader, version) ?? "ask";
}
