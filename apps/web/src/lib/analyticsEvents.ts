/**
 * The only analytics events Chitrapx records, and the only prop values each may carry. Shared by
 * the browser (track) and the server (/api/events), so nothing outside this list is ever stored:
 * no project content, names, file names, emails or ids.
 */
export const EVENTS = {
  page_view: {},
  sign_up: {},
  project_created: { source: ["template", "blank", "community"] },
  export_started: { kind: ["zip"] },
  community_published: {},
  community_imported: {},
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type EventName = keyof typeof EVENTS;
export type CleanEvent = { name: EventName; path: string; props: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PATH = 200;

/** A pathname with no query or hash, ids as `:id`, anything with `@` as `:x`, long numbers as `:n`. */
export function normalizePath(raw: string): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  const pathname = raw.split(/[?#]/)[0]!;
  const segments = pathname.split("/").map((s) => {
    if (!s) return s;
    if (UUID.test(s)) return ":id";
    if (s.includes("@") || s.includes("%40")) return ":x";
    if (/^\d{4,}$/.test(s)) return ":n";
    return s;
  });
  return segments.join("/").slice(0, MAX_PATH) || "/";
}

/** The event as it may be stored, or null for an unknown event. Unknown props and values are dropped. */
export function cleanEvent(raw: unknown): CleanEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const { name, path, props } = raw as { name?: unknown; path?: unknown; props?: unknown };
  if (typeof name !== "string" || !Object.hasOwn(EVENTS, name)) return null;
  const allowed = EVENTS[name as EventName] as Record<string, readonly string[]>;
  const clean: Record<string, string> = {};
  if (props && typeof props === "object") {
    for (const [k, v] of Object.entries(props)) {
      if (Object.hasOwn(allowed, k) && typeof v === "string" && allowed[k]!.includes(v)) clean[k] = v;
    }
  }
  return { name: name as EventName, path: normalizePath(typeof path === "string" ? path : "/"), props: clean };
}
