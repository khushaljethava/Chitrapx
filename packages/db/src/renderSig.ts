import { createHmac, timingSafeEqual } from "node:crypto";

/** The worker opens the web render page with a short-lived HMAC; nothing else can load it. */
const MAX_TTL_MS = 15 * 60_000;

function secret(): string {
  const s = process.env.RENDER_SECRET;
  if (!s || s.length < 32) throw new Error("RENDER_SECRET must be set (32+ characters)");
  return s;
}
const sign = (jobId: string, exp: string) => createHmac("sha256", secret()).update(`${jobId}.${exp}`).digest("hex");

export function renderUrl(origin: string, jobId: string, ttlMs = MAX_TTL_MS): string {
  const exp = String(Date.now() + ttlMs);
  return `${origin}/render/${jobId}?exp=${exp}&sig=${sign(jobId, exp)}`;
}

export function verifyRenderSig(jobId: string, exp: string | undefined, sig: string | undefined, now = Date.now()): boolean {
  if (!exp || !sig || !/^\d{13}$/.test(exp) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const expiry = Number(exp);
  if (expiry <= now || expiry - now > MAX_TTL_MS + 60_000) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(sign(jobId, exp), "hex"));
}
