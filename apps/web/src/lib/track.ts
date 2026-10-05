import { cleanEvent, type EventName } from "./analyticsEvents.ts";

/**
 * Sends one allow-listed event to our own /api/events, only while the visitor has consented.
 * The consent banner flips `enabled`, so revoking stops events at once, without a reload.
 */
let enabled = false;
type Transport = (body: string) => void;
let transport: Transport | null = null;

export function setTrackingEnabled(on: boolean) { enabled = on; }
/** Tests replace how events leave the page; null restores the beacon. */
export function setTransport(fn: Transport | null) { transport = fn; }

function beacon(body: string) {
  try {
    if (navigator.sendBeacon?.("/api/events", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/events", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  } catch { /* analytics must never break the page */ }
}

/** True when the event was sent. */
export function track(name: EventName, props?: Record<string, string>): boolean {
  if (!enabled) return false;
  const event = cleanEvent({ name, props, path: typeof location === "undefined" ? "/" : location.pathname });
  if (!event) return false;
  (transport ?? beacon)(JSON.stringify(event));
  return true;
}
