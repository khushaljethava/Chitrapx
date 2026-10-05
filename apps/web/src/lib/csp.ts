/**
 * The Content-Security-Policy Chitrapx sends, for now as Report-Only (proxy.ts) so violations show
 * in the console without breaking anything. Analytics is same-origin (/api/events), so no analytics
 * host appears. `'unsafe-inline'` stays in script-src: nonces would force every page to render per
 * request, including the static changelog. Enforce once reports are clean.
 */
export function cspHeader({ supabaseUrl, storageEndpoint, dev }: { supabaseUrl: string; storageEndpoint?: string; dev: boolean }): string {
  const origin = (u?: string) => { try { return u ? new URL(u).origin : ""; } catch { return ""; } };
  const supabase = origin(supabaseUrl);
  const storage = origin(storageEndpoint);
  // Without an explicit endpoint the storage is AWS S3 (virtual-hosted buckets).
  const store = storage || "https://*.amazonaws.com";
  const razorpay = "https://checkout.razorpay.com";
  const list = (...xs: string[]) => xs.filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src ${list("'self'", "'unsafe-inline'", dev ? "'unsafe-eval'" : "", razorpay)}`,
    `style-src ${list("'self'", "'unsafe-inline'", "https://fonts.googleapis.com")}`,
    `font-src ${list("'self'", "data:", "https://fonts.gstatic.com", store)}`,
    `img-src ${list("'self'", "data:", "blob:", store, supabase)}`,
    `media-src ${list("'self'", "blob:", store)}`,
    `connect-src ${list("'self'", supabase, supabase.replace(/^https:/, "wss:"), store, "https://api.razorpay.com", "https://lumberjack.razorpay.com")}`,
    `frame-src ${list("https://api.razorpay.com", razorpay)}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
