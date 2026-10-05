import { db, schema } from "@chitrapx/db";
import { cleanEvent } from "@/lib/analyticsEvents.ts";
import { analyticsEnabled } from "@/lib/consent.ts";
import { HttpError, readTextLimited } from "@/server/http.ts";

const MAX_BODY = 1024;
const none = () => new Response(null, { status: 204 });

/**
 * First-party analytics sink. The browser only calls it after consent; it stores the allow-listed
 * event name, a normalised path and allow-listed props. Nothing identifies the visitor: no user id,
 * cookie, IP, user agent or referrer is read or kept.
 */
export async function POST(req: Request) {
  if (!analyticsEnabled()) return none();
  let raw: unknown;
  try { raw = JSON.parse(await readTextLimited(req, MAX_BODY)); }
  catch (err) { return err instanceof HttpError && err.status === 413 ? new Response(null, { status: 413 }) : none(); }
  const event = cleanEvent(raw);
  if (event) await db.insert(schema.analyticsEvents).values(event).catch(() => { /* counting must never fail a page */ });
  return none();
}
