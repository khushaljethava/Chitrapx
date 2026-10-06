import type { ChitrapxDoc } from "@chitrapx/document";
import type { Command } from "../commands.ts";
import {
  addLocal, applySnapshot, dropRejected, hold, initSync, integrate, markInflight, releaseHeld, resetSync, type Pending, type SyncState,
} from "./core.ts";
import { BATCH_MAX, type CatchUp, type ItemResult, type LogEntry, type SubmitResponse } from "./log.ts";

/** A document event from the server-only channel. Only ever a hint: the HTTP API is the source of truth. */
export type LiveEvent = { type: "commands"; entries: LogEntry[] } | { type: "head"; head: number };

/** `status` is the HTTP status, or null for a network failure. */
export class TransportError extends Error {
  constructor(public status: number | null, message: string) { super(message); }
}
export type SyncTransport = {
  submit(body: { clientId: string; after: number; commands: Pending[] }): Promise<SubmitResponse>;
  fetchSince(after: number, clientId: string): Promise<CatchUp>;
};
export type LiveStatus = { state: "saved" | "unsaved" | "saving" | "offline" | "error" | "stopped"; message?: string };
/** `changed`: the document differs from what the editor shows (someone else's edit, a snapshot, a refused command). */
export type LiveView = { doc: ChitrapxDoc; seq: number; dirty: boolean; changed: boolean };
type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

export type LiveSyncOptions = {
  clientId: string;
  doc: ChitrapxDoc;
  seq: number;
  nextClientSeq?: number;
  transport: SyncTransport;
  onView(view: LiveView): void;
  onStatus?(status: LiveStatus): void;
  onRejected?(results: ItemResult[]): void;
  /** Pending commands changed (for the IndexedDB draft). */
  onPending?(pending: Pending[], seq: number): void;
  sendDelayMs?: number;
  timers?: Timers;
};

const SEND_DELAY_MS = 120;
const MAX_BACKOFF_MS = 10_000;
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * One live editor's connection to the command log: sends pending commands (one request at a time,
 * idempotent by clientSeq), integrates ordered entries from responses and broadcasts, and catches up
 * over HTTP whenever it sees a gap or a newer head. Pure state lives in `core.ts`.
 */
export class LiveSync {
  private s: SyncState;
  private timers: Timers;
  private timer: unknown = null;
  private inflight: Promise<boolean> | null = null;
  private catching: Promise<void> | null = null;
  private catchAgain = false;
  private backoff = 0;
  private maxBatch = BATCH_MAX;
  private stopped = false;
  status: LiveStatus = { state: "saved" };

  constructor(private o: LiveSyncOptions) {
    this.s = initSync({ clientId: o.clientId, doc: o.doc, seq: o.seq, nextClientSeq: o.nextClientSeq });
    this.timers = o.timers ?? realTimers;
  }

  get view() { return this.s.view; }
  get seq() { return this.s.seq; }
  get pending() { return this.s.pending; }
  get dirty() { return this.s.pending.length > 0 || this.s.held.length > 0; }
  get clientId() { return this.s.clientId; }

  /** A command the editor applied (`after`: its result, to skip applying it again). Transient ones wait for `gestureEnd`. */
  local(cmd: Command, opts?: { transient?: boolean; after?: ChitrapxDoc }): void {
    this.s = opts?.transient ? hold(this.s, cmd, opts.after) : addLocal(this.s, cmd, opts?.after);
    if (opts?.transient) return;
    this.pendingChanged();
    if (!this.inflight) this.setStatus({ state: "unsaved" });
    this.schedule(this.o.sendDelayMs ?? SEND_DELAY_MS);
  }

  /** A drag ended: its held frames become one (coalesced) command. */
  gestureEnd(): void {
    if (!this.s.held.length) return;
    this.s = releaseHeld(this.s);
    this.pendingChanged();
    if (!this.inflight) this.setStatus({ state: "unsaved" });
    this.schedule(this.o.sendDelayMs ?? SEND_DELAY_MS);
  }

  receive(e: LiveEvent): void {
    if (this.stopped) return;
    if (e.type === "head") { if (e.head > this.s.seq) void this.catchUp(); return; }
    const r = integrate(this.s, e.entries);
    this.s = r.state;
    this.emit(r.changed);
    if (r.gap) void this.catchUp();
  }

  /** Fetches what this client missed: entries, or a snapshot when the log has a hole. */
  catchUp(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.catching) { this.catchAgain = true; return this.catching; }
    this.catching = (async () => {
      for (let i = 0; i < 3; i++) {
        this.catchAgain = false;
        try { this.applyCatchUp(await this.o.transport.fetchSince(this.s.seq, this.s.clientId), false); }
        catch (err) { this.fail(err, 0); break; }
        if (!this.catchAgain) break;
      }
    })().finally(() => { this.catching = null; });
    return this.catching;
  }

  /** Sends everything pending. True once the server has it all (nothing held either). */
  async flush(): Promise<boolean> {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    for (let i = 0; i < 1000; i++) {
      if (this.inflight) { await this.inflight; continue; }
      if (this.stopped) return false;
      if (!this.s.pending.length) return !this.s.held.length;
      if (!(await this.send())) return false;
    }
    return false;
  }

  /** Adopt a server document (after a doc job or restore); nothing local is kept. */
  reset(doc: ChitrapxDoc, seq: number): void {
    this.s = resetSync(this.s, doc, seq);
    this.pendingChanged();
    this.emit(false);
    this.setStatus({ state: "saved" });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.send().then((ok) => { if (this.s.pending.length && !this.stopped) this.schedule(ok ? this.o.sendDelayMs ?? SEND_DELAY_MS : this.backoff); });
    }, ms);
  }

  private send(): Promise<boolean> {
    if (this.inflight) return this.inflight;
    if (this.stopped || !this.s.pending.length) return Promise.resolve(!this.stopped);
    const p = this.doSend().finally(() => { this.inflight = null; });
    this.inflight = p;
    return p;
  }

  private async doSend(): Promise<boolean> {
    const batch = this.s.pending.slice(0, this.maxBatch);
    this.s = markInflight(this.s, batch.at(-1)!.clientSeq);
    this.setStatus({ state: "saving" });
    try {
      const res = await this.o.transport.submit({ clientId: this.s.clientId, after: this.s.seq, commands: batch });
      const refused = res.results.filter((r) => r.error);
      if (refused.length) this.reject(refused);
      this.applyCatchUp(res, refused.length > 0);
      this.backoff = 0;
      this.maxBatch = BATCH_MAX;
      this.setStatus({ state: this.s.pending.length ? "unsaved" : "saved" });
      return true;
    } catch (err) {
      return this.fail(err, batch.length);
    }
  }

  private reject(results: ItemResult[]): void {
    this.s = dropRejected(this.s, results.map((r) => r.clientSeq));
    this.pendingChanged();
    this.o.onRejected?.(results);
  }

  /** True when sending may continue at once (the batch was split or dropped). */
  private fail(err: unknown, batchLen: number): boolean {
    const status = err instanceof TransportError ? err.status : null;
    if (batchLen && status === 403) {
      // May read but not edit (a viewer): refuse these edits, keep receiving everyone else's.
      const message = (err as Error).message || "You can view this project but not edit it";
      this.reject(this.s.pending.slice(0, batchLen).map((p) => ({ clientSeq: p.clientSeq, error: message })));
      this.emit(true);
      this.setStatus({ state: "error", message });
      return true;
    }
    if (status === 401 || status === 403 || status === 404) {
      this.stop();
      this.setStatus({ state: "stopped", message: "You no longer have access to this project." });
      return false;
    }
    if (batchLen && status === 413 && batchLen > 1) { this.maxBatch = Math.max(1, Math.floor(batchLen / 2)); return true; }
    if (batchLen && status !== null && status >= 400 && status < 500) {
      // The server will refuse these exact commands again: drop them, never retry forever.
      const message = status === 413 ? "too large" : (err as Error).message || "refused";
      this.reject(this.s.pending.slice(0, batchLen).map((p) => ({ clientSeq: p.clientSeq, error: message })));
      this.emit(true);
      return true;
    }
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff ? this.backoff * 2 : 1000);
    this.setStatus({ state: status === null ? "offline" : "error" });
    return false;
  }

  private applyCatchUp(cu: CatchUp, forceEmit: boolean): void {
    let changed = forceEmit;
    if ("entries" in cu) {
      const r = integrate(this.s, cu.entries);
      this.s = r.state;
      changed ||= r.changed;
      if (r.gap || cu.head > this.s.seq) void this.catchUp();
    } else {
      const before = this.s;
      this.s = applySnapshot(this.s, cu.snapshot.doc, cu.head, cu.snapshot.lastClientSeq);
      changed ||= this.s !== before;
    }
    this.pendingChanged();
    this.emit(changed);
  }

  private emit(changed: boolean): void {
    this.o.onView({ doc: this.s.view, seq: this.s.seq, dirty: this.dirty, changed });
  }

  private pendingChanged(): void { this.o.onPending?.(this.s.pending, this.s.seq); }

  private setStatus(status: LiveStatus): void {
    if (this.stopped && status.state !== "stopped") return;
    if (status.state === this.status.state && status.message === this.status.message) return;
    this.status = status;
    this.o.onStatus?.(status);
  }
}
