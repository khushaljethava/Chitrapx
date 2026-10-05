/** First check after load: long enough to stay out of the way of the page's own requests. */
export const FIRST_CHECK_MS = 30_000;
export const CHECK_EVERY_MS = 5 * 60_000;

/**
 * Polls for the deployed build id: FIRST_CHECK_MS after start, then every CHECK_EVERY_MS, and
 * whenever the tab becomes visible. Calls `onUpdate` once with the first id that differs from
 * `current`, then stops. Errors and empty answers are ignored (offline, a deploy in progress).
 */
export function watchForUpdate(opts: {
  current: string;
  fetchBuildId: () => Promise<string | null>;
  onUpdate: (buildId: string) => void;
  /** Calls `cb` when the tab becomes visible; returns an unsubscribe. */
  subscribeVisible: (cb: () => void) => () => void;
  firstDelayMs?: number;
  intervalMs?: number;
}): { stop: () => void; checkNow: () => void } {
  let stopped = false;
  let checking = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = opts.subscribeVisible(() => void check());

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  }
  function schedule(ms: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => { await check(); if (!stopped) schedule(opts.intervalMs ?? CHECK_EVERY_MS); }, ms);
  }
  async function check() {
    if (stopped || checking) return;
    checking = true;
    try {
      const id = await opts.fetchBuildId();
      if (!stopped && id && id !== opts.current) { stop(); opts.onUpdate(id); }
    } catch { /* offline or mid-deploy: try again later */ }
    finally { checking = false; }
  }

  schedule(opts.firstDelayMs ?? FIRST_CHECK_MS);
  return { stop, checkNow: () => void check() };
}

/** The build id the server is running now, or null when it cannot tell. Never throws, never logs. */
export async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { buildId?: unknown };
    return typeof body.buildId === "string" ? body.buildId : null;
  } catch { return null; }
}
