/** Only same-origin paths; blocks open redirects like //evil.com or https://evil.com. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}
