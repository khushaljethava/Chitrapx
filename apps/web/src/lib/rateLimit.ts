/**
 * A small in-memory fixed-window limiter, per server process. Enough to stop one client
 * hammering a public link; not a distributed or DDoS defence.
 */
export function rateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }) {
  const hits = new Map<string, { window: number; count: number }>();
  return (key: string): boolean => {
    const window = Math.floor(now() / windowMs);
    if (hits.size >= maxKeys) for (const [k, v] of hits) if (v.window !== window) hits.delete(k);
    const entry = hits.get(key);
    if (!entry || entry.window !== window) {
      hits.set(key, { window, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

/** The caller's address as the proxy reports it. */
export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}
