import type { ChitrapxDoc } from "@chitrapx/document";

/**
 * Live co-editing presence (SP15), pure. Presence and cursors travel client to client on the private
 * `project-live:<id>` channel, so every payload from a peer is parsed defensively before it is drawn.
 * Coordinates are strip coordinates of a group (board i spans x = i·width … (i+1)·width), identical for
 * everyone because all clients render the same document.
 */
export type PeerPresence = {
  clientId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  groupId: string;
  boardId: string | null;
  /** Selected element ids in `groupId`. */
  selection: string[];
  canEdit: boolean;
};
export type PeerCursor = { clientId: string; groupId: string; x: number; y: number; at: number };
export type PreviewBox = { elementId: string; x: number; y: number; w: number; h: number; rotation: number };
export type PeerPreview = { clientId: string; groupId: string; boxes: PreviewBox[]; at: number };

/** Readable on light and dark canvases. */
export const PALETTE = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#4d7c0f"];

export function colorFor(userId: string): string {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) h = Math.imul(h ^ userId.charCodeAt(i), 16777619);
  return PALETTE[(h >>> 0) % PALETTE.length]!;
}

export function initials(name: string): string {
  const words = name.split("@")[0]!.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parsePeer(v: unknown): PeerPresence | null {
  const p = v as Record<string, unknown> | null;
  if (!p || !str(p.clientId) || !str(p.userId) || !str(p.name) || !str(p.groupId)) return null;
  return {
    clientId: p.clientId, userId: p.userId, name: p.name.slice(0, 80), groupId: p.groupId,
    avatarUrl: str(p.avatarUrl, 2000) && /^https:\/\//.test(p.avatarUrl) ? p.avatarUrl : null,
    color: str(p.color, 16) && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : colorFor(p.userId),
    boardId: str(p.boardId) ? p.boardId : null,
    selection: Array.isArray(p.selection) ? p.selection.filter((s): s is string => str(s)).slice(0, 200) : [],
    canEdit: p.canEdit !== false,
  };
}

/** Other sessions in Supabase presence state (`{ key: [meta, …] }`), the newest meta per client, sorted by name. */
export function peersFrom(state: Record<string, unknown[]>, myClientId: string): PeerPresence[] {
  const byClient = new Map<string, PeerPresence>();
  for (const metas of Object.values(state)) {
    for (const meta of metas ?? []) {
      const p = parsePeer(meta);
      if (p && p.clientId !== myClientId) byClient.set(p.clientId, p);
    }
  }
  return [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name) || a.clientId.localeCompare(b.clientId));
}

export function parseCursor(v: unknown, now = Date.now()): PeerCursor | null {
  const c = v as Record<string, unknown> | null;
  if (!c || !str(c.clientId) || !str(c.groupId) || !num(c.x) || !num(c.y)) return null;
  return { clientId: c.clientId, groupId: c.groupId, x: c.x, y: c.y, at: now };
}

export function parsePreview(v: unknown, now = Date.now()): PeerPreview | null {
  const p = v as Record<string, unknown> | null;
  if (!p || !str(p.clientId) || !str(p.groupId) || !Array.isArray(p.boxes)) return null;
  const boxes = p.boxes.slice(0, 50).flatMap((b: Record<string, unknown> | null) =>
    b && str(b.elementId) && num(b.x) && num(b.y) && num(b.w) && num(b.h)
      ? [{ elementId: b.elementId, x: b.x, y: b.y, w: b.w, h: b.h, rotation: num(b.rotation) ? b.rotation : 0 }] : []);
  return { clientId: p.clientId, groupId: p.groupId, boxes, at: now };
}

/** Calls `fn` at once, then at most once per `ms` with the latest arguments. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = (...args: A) => {
    const wait = last + ms - Date.now();
    if (wait <= 0 && !timer) { last = Date.now(); fn(...args); return; }
    pending = args;
    timer ??= setTimeout(() => {
      timer = null;
      last = Date.now();
      if (pending) { const a = pending; pending = null; fn(...a); }
    }, Math.max(0, wait));
  };
  return Object.assign(run, { cancel: () => { if (timer) clearTimeout(timer); timer = null; pending = null; } });
}

const ASSET = /"asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:#poster)?"/g;
/** Asset ids the document references that `resolve` has no URL for (a peer uploaded them). */
export function unknownAssetIds(doc: ChitrapxDoc, resolve: (src: string) => string | null): string[] {
  const out = new Set<string>();
  for (const m of JSON.stringify(doc).matchAll(ASSET)) if (!resolve(`asset:${m[1]}`)) out.add(m[1]!);
  return [...out];
}
