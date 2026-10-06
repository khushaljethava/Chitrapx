import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { LiveSync, TransportError, type LiveEvent, type SyncTransport } from "@/editor/sync/engine.ts";
import { applyBatch, CATCH_UP_MAX, isContiguous, type CatchUp, type LogEntry, type SubmitResponse } from "@/editor/sync/log.ts";
import type { Pending } from "@/editor/sync/core.ts";

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** What `server/commands.ts` does, in memory: the same `applyBatch`, a log, and broadcasts after "commit". */
export class FakeServer {
  head: number;
  log: LogEntry[] = [];
  /** Every change in order: a log entry, or a whole-document write (the worker, a solo save). */
  history: Array<{ entry: LogEntry } | { whole: ChitrapxDoc }> = [];
  readonly hub = new Hub();
  constructor(public doc: ChitrapxDoc, head = 0) { this.head = head; }

  submit(body: { clientId: string; after: number; commands: Pending[] }, userId: string | null = null): SubmitResponse {
    const mine = this.log.filter((e) => e.clientId === body.clientId).map((e) => e.clientSeq);
    const out = applyBatch({
      doc: this.doc, head: this.head, lastClientSeq: mine.length ? Math.max(...mine) : null,
      clientId: body.clientId, userId, items: body.commands, validate: migrate,
    });
    this.doc = out.doc;
    this.head = out.head;
    this.log.push(...out.entries);
    this.history.push(...out.entries.map((entry) => ({ entry })));
    if (out.entries.length) this.hub.publish({ type: "commands", entries: wire(out.entries) });
    return { ...this.since(body.after, body.clientId), results: out.results };
  }

  since(after: number, clientId: string): CatchUp {
    const rows = this.log.filter((e) => e.seq > after && e.seq <= this.head);
    if (after <= this.head && rows.length <= CATCH_UP_MAX && isContiguous(after, this.head, rows)) return { head: this.head, entries: wire(rows) };
    const mine = this.log.filter((e) => e.clientId === clientId).map((e) => e.clientSeq);
    return { head: this.head, snapshot: { doc: wire(this.doc), lastClientSeq: mine.length ? Math.max(...mine) : null } };
  }

  /** A whole-document write that bypasses the log (AI job, solo PUT, restore): leaves a hole. */
  writeWhole(fn: (doc: ChitrapxDoc) => ChitrapxDoc): void {
    this.doc = migrate(fn(this.doc));
    this.head += 1;
    this.history.push({ whole: this.doc });
    this.hub.publish({ type: "head", head: this.head });
  }
}

/** Broadcast fan-out. Queued per subscriber so tests choose when (and whether) each message arrives. */
export class Hub {
  private subs = new Map<string, { deliver: (e: LiveEvent) => void; queue: LiveEvent[] }>();
  auto = false;
  subscribe(id: string, deliver: (e: LiveEvent) => void) { this.subs.set(id, { deliver, queue: [] }); }
  publish(e: LiveEvent) {
    for (const s of this.subs.values()) { if (this.auto) s.deliver(wire(e)); else s.queue.push(wire(e)); }
  }
  /** Delivers queued messages for one subscriber (all, or the first n), optionally dropping some. */
  deliver(id: string, opts?: { n?: number; drop?: (e: LiveEvent, i: number) => boolean }) {
    const s = this.subs.get(id)!;
    const batch = s.queue.splice(0, opts?.n ?? s.queue.length);
    batch.forEach((e, i) => { if (!opts?.drop?.(e, i)) s.deliver(e); });
  }
  queued(id: string) { return this.subs.get(id)!.queue.length; }
}

export type Net = { online: boolean; loseNextResponse: boolean; status?: number };

/** A transport over the fake server; awaits a tick like a network would. */
export function fakeTransport(server: FakeServer, net: Net, userId: string | null = null): SyncTransport {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    async submit(body) {
      await tick();
      if (net.status) throw new TransportError(net.status, "refused");
      if (!net.online) throw new TransportError(null, "offline");
      const res = server.submit(wire(body), userId);
      if (net.loseNextResponse) { net.loseNextResponse = false; throw new TransportError(null, "lost"); }
      return wire(res);
    },
    async fetchSince(after, clientId) {
      await tick();
      if (net.status) throw new TransportError(net.status, "refused");
      if (!net.online) throw new TransportError(null, "offline");
      return server.since(after, clientId);
    },
  };
}

export type Client = { id: string; sync: LiveSync; net: Net; doc: () => ChitrapxDoc; rejected: string[] };

/** A live client wired to the fake server and hub. Timers never fire on their own: tests drive sending. */
export function client(server: FakeServer, id: string): Client {
  const net: Net = { online: true, loseNextResponse: false };
  const rejected: string[] = [];
  const sync = new LiveSync({
    clientId: id, doc: wire(server.doc), seq: server.head, transport: fakeTransport(server, net),
    onView: () => {},
    onRejected: (r) => rejected.push(...r.map((x) => x.error ?? "")),
    timers: { set: () => 0, clear: () => {} },
  });
  server.hub.subscribe(id, (e) => sync.receive(e));
  return { id, sync, net, doc: () => sync.view, rejected };
}

/** Lets pending promise chains (fake network ticks) run. */
export const settle = async (rounds = 5) => { for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0)); };
