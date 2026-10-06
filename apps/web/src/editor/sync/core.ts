import type { ChitrapxDoc } from "@chitrapx/document";
import { applyCommand, type Command, type Ref } from "../commands.ts";
import type { LogEntry } from "./log.ts";
import { diffDocs } from "./patch.ts";

/**
 * A live editor's sync state (SP15), as pure functions. `confirmed` is the server document at `seq`;
 * `pending` are this client's commands the log does not have yet; `held` are transient drag commands
 * that are not sent until the gesture ends. What the user sees is `view = fold(confirmed, pending, held)`:
 * whenever the server orders someone else's command, everything still pending is re-applied on top.
 */
export type Pending = { clientSeq: number; command: Command };
export type SyncState = Readonly<{
  clientId: string;
  confirmed: ChitrapxDoc;
  seq: number;
  pending: Pending[];
  held: Command[];
  view: ChitrapxDoc;
  nextClientSeq: number;
  /** Commands up to this clientSeq may already be at the server: they are never coalesced. */
  inflightUpTo: number;
  /** The view just before the last pending command, while that command can still absorb the next one. */
  tailBase: ChitrapxDoc | null;
  /** The view before the first held command. */
  heldBase: ChitrapxDoc | null;
}>;

const fold = (doc: ChitrapxDoc, cmds: Command[]) => cmds.reduce(applyCommand, doc);
const views = (confirmed: ChitrapxDoc, pending: Pending[], held: Command[]) => {
  const base = fold(confirmed, pending.map((p) => p.command));
  return { view: fold(base, held), heldBase: held.length ? base : null };
};

export function initSync(init: { clientId: string; doc: ChitrapxDoc; seq: number; nextClientSeq?: number }): SyncState {
  return {
    clientId: init.clientId, confirmed: init.doc, seq: init.seq, pending: [], held: [], view: init.doc,
    nextClientSeq: init.nextClientSeq ?? 1, inflightUpTo: 0, tailBase: null, heldBase: null,
  };
}

const sameRef = (a: Ref, b: Ref) => a.groupId === b.groupId && a.boardId === b.boardId && a.elementId === b.elementId;
const sameRefs = (a: Ref[], b: Ref[]) => a.length === b.length && a.every((r, i) => sameRef(r, b[i]!));

/** One command doing what `a` then `b` do, when the pair has an obvious merged form (checked by the caller). */
function merge(a: Command, b: Command): Command | null {
  if (a.type === "updateElement" && b.type === "updateElement" && sameRef(a.ref, b.ref)) return { ...b, props: { ...a.props, ...b.props } as typeof b.props };
  if (a.type === "moveElements" && b.type === "moveElements" && sameRefs(a.refs, b.refs)) return { ...a, dx: a.dx + b.dx, dy: a.dy + b.dy };
  if (a.type === "setOverride" && b.type === "setOverride" && sameRef(a.ref, b.ref) && a.locale === b.locale) return { ...b, props: { ...a.props, ...b.props } };
  if (a.type === "updateBoard" && b.type === "updateBoard" && a.groupId === b.groupId && a.boardId === b.boardId) return { ...b, props: { ...a.props, ...b.props } };
  if (a.type === "setTextRich" && b.type === "setTextRich" && sameRef(a.ref, b.ref) && a.locale === b.locale) return b;
  return null;
}

/** `last` then `cmd`, as one command, only if applying it to `base` gives exactly `next`. */
function absorb(base: ChitrapxDoc, last: Command, cmd: Command, next: ChitrapxDoc): Command | null {
  const m = merge(last, cmd);
  if (!m) return null;
  try { return diffDocs(next, applyCommand(base, m)).length === 0 ? m : null; } catch { return null; }
}

/** Held commands, coalesced, become pending (in order). */
export function releaseHeld(s: SyncState): SyncState {
  if (!s.held.length) return s;
  const out: Command[] = [];
  let lastBase: ChitrapxDoc | null = null;
  let cur = s.heldBase ?? fold(s.confirmed, s.pending.map((p) => p.command));
  for (const cmd of s.held) {
    const next = applyCommand(cur, cmd);
    const merged = out.length && lastBase ? absorb(lastBase, out.at(-1)!, cmd, next) : null;
    if (merged) out[out.length - 1] = merged;
    else { out.push(cmd); lastBase = cur; }
    cur = next;
  }
  const pending = [...s.pending, ...out.map((command, i) => ({ clientSeq: s.nextClientSeq + i, command }))];
  return { ...s, pending, held: [], heldBase: null, nextClientSeq: s.nextClientSeq + out.length, tailBase: lastBase };
}

/** A local command (already applied by the editor: pass its result as `after` to skip re-applying it). */
export function addLocal(state: SyncState, cmd: Command, after?: ChitrapxDoc): SyncState {
  const s = releaseHeld(state);
  const next = after ?? applyCommand(s.view, cmd);
  const last = s.pending.at(-1);
  if (last && last.clientSeq > s.inflightUpTo && s.tailBase) {
    const merged = absorb(s.tailBase, last.command, cmd, next);
    if (merged) return { ...s, pending: [...s.pending.slice(0, -1), { clientSeq: last.clientSeq, command: merged }], view: next };
  }
  return { ...s, pending: [...s.pending, { clientSeq: s.nextClientSeq, command: cmd }], nextClientSeq: s.nextClientSeq + 1, tailBase: s.view, view: next };
}

/** A transient command (a drag frame): shown now, sent when the gesture ends. */
export function hold(s: SyncState, cmd: Command, after?: ChitrapxDoc): SyncState {
  return { ...s, held: [...s.held, cmd], heldBase: s.heldBase ?? s.view, view: after ?? applyCommand(s.view, cmd) };
}

export const markInflight = (s: SyncState, upTo: number): SyncState => ({ ...s, inflightUpTo: Math.max(s.inflightUpTo, upTo) });

/**
 * Applies log entries in seq order. Stops at a gap (the caller catches up). Our own entries pop pending;
 * anyone else's entries rebase pending and held commands onto the new confirmed document (`changed`).
 */
export function integrate(s: SyncState, entries: LogEntry[]): { state: SyncState; gap: boolean; changed: boolean } {
  let { confirmed, seq, pending } = s;
  let foreign = false, applied = false, gap = false;
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.seq <= seq) continue;
    if (e.seq !== seq + 1) { gap = true; break; }
    try { confirmed = applyCommand(confirmed, e.command); } catch { gap = true; break; }
    seq = e.seq;
    applied = true;
    if (e.clientId === s.clientId) pending = pending.filter((p) => p.clientSeq > e.clientSeq);
    else foreign = true;
  }
  if (!applied) return { state: s, gap, changed: false };
  if (!foreign) return { state: { ...s, confirmed, seq, pending }, gap, changed: false };
  return { state: { ...s, confirmed, seq, pending, ...views(confirmed, pending, s.held), tailBase: null }, gap, changed: true };
}

/** The server's whole document at `seq`. Pending commands up to `lastClientSeq` are already in it. An older snapshot is ignored. */
export function applySnapshot(s: SyncState, doc: ChitrapxDoc, seq: number, lastClientSeq: number | null): SyncState {
  if (seq < s.seq) return s;
  const pending = lastClientSeq === null ? s.pending : s.pending.filter((p) => p.clientSeq > lastClientSeq);
  return { ...s, confirmed: doc, seq, pending, ...views(doc, pending, s.held), tailBase: null };
}

/** The server refused these commands: they leave the view. */
export function dropRejected(s: SyncState, clientSeqs: number[]): SyncState {
  const drop = new Set(clientSeqs);
  const pending = s.pending.filter((p) => !drop.has(p.clientSeq));
  if (pending.length === s.pending.length) return s;
  return { ...s, pending, ...views(s.confirmed, pending, s.held), tailBase: null };
}

/** Adopt a server document (after a doc job or a restore): nothing local is left. */
export function resetSync(s: SyncState, doc: ChitrapxDoc, seq: number): SyncState {
  return { ...s, confirmed: doc, seq, pending: [], held: [], view: doc, tailBase: null, heldBase: null };
}
