import { describe, expect, it } from "vitest";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { applyCommand, type Command } from "@/editor/commands.ts";
import { LiveSync } from "@/editor/sync/engine.ts";
import { client, FakeServer, settle, type Client } from "./support/fakeLive.ts";
import { el, ids, newText, plain, ref, syncDoc } from "./support/syncDoc.ts";

const color = (c: string, id = "t1"): Command => ({ type: "updateElement", ref: ref(id), props: { color: c } as never });
const move = (dx: number, id = "t1"): Command => ({ type: "moveElements", refs: [ref(id)], dx, dy: 0 });

function setup(n = 2) {
  const server = new FakeServer(syncDoc());
  const clients = Array.from({ length: n }, (_, i) => client(server, `c${i}`));
  return { server, clients };
}
/** Sends everything, delivers every broadcast, and catches everyone up. */
async function quiesce(server: FakeServer, clients: Client[]) {
  for (let round = 0; round < 4; round++) {
    for (const c of clients) { c.net.online = true; await c.sync.flush(); }
    for (const c of clients) server.hub.deliver(c.id);
    for (const c of clients) await c.sync.catchUp();
  }
}
const converged = (server: FakeServer, clients: Client[]) => {
  for (const c of clients) {
    expect(c.sync.pending).toEqual([]);
    expect(plain(c.doc())).toEqual(plain(server.doc));
  }
};

describe("LiveSync with two clients", () => {
  it("concurrent edits to different elements both survive everywhere", async () => {
    const { server, clients: [a, b] } = setup();
    a!.sync.local(move(30, "t1"));
    b!.sync.local(color("#ff0000", "t2"));
    await a!.sync.flush();
    await b!.sync.flush();
    await quiesce(server, [a!, b!]);
    converged(server, [a!, b!]);
    expect(el(server.doc, "t1")!.position.x).toBe(30);
    expect(el(server.doc, "t2")!.color).toBe("#ff0000");
  });

  it("edits to the same property converge on the later one in server order", async () => {
    const { server, clients: [a, b] } = setup();
    a!.sync.local(color("#ff0000"));
    b!.sync.local(color("#00ff00"));
    await a!.sync.flush();
    await b!.sync.flush();
    server.hub.deliver("c0");
    expect(el(a!.doc(), "t1")!.color).toBe("#00ff00");
    await quiesce(server, [a!, b!]);
    converged(server, [a!, b!]);
    expect(el(server.doc, "t1")!.color).toBe("#00ff00");
  });

  it("a delete during the other client's drag neither throws nor resurrects the element", async () => {
    const { server, clients: [a, b] } = setup();
    for (let i = 0; i < 10; i++) a!.sync.local(move(3), { transient: true });
    b!.sync.local({ type: "deleteElements", refs: [ref("t1")] });
    await b!.sync.flush();
    server.hub.deliver("c0");
    expect(el(a!.doc(), "t1")).toBeUndefined();
    a!.sync.gestureEnd();
    await a!.sync.flush();
    await quiesce(server, [a!, b!]);
    converged(server, [a!, b!]);
    expect(ids(server.doc)).toEqual(["t2", "t3"]);
    expect(server.log.filter((e) => e.clientId === "c0")).toHaveLength(1); // the whole drag was one command
  });

  it("100 queued offline commands are sent on reconnect and applied once, even when a response is lost", async () => {
    const { server, clients: [a, b] } = setup();
    a!.net.online = false;
    for (let i = 0; i < 100; i++) a!.sync.local(move(1, i % 2 ? "t2" : "t1"));
    expect(await a!.sync.flush()).toBe(false);
    expect(a!.sync.status.state).toBe("offline");
    b!.sync.local(color("#123456", "t3"));
    await b!.sync.flush();
    a!.net.online = true;
    a!.net.loseNextResponse = true;
    expect(await a!.sync.flush()).toBe(false); // applied by the server, but the answer never arrived
    expect(await a!.sync.flush()).toBe(true); // resent: acknowledged as duplicates
    await quiesce(server, [a!, b!]);
    converged(server, [a!, b!]);
    expect(server.log.filter((e) => e.clientId === "c0")).toHaveLength(100);
    expect(el(server.doc, "t1")!.position.x).toBe(50);
    expect(el(server.doc, "t2")!.position.x).toBe(100);
    expect(el(server.doc, "t3")!.color).toBe("#123456");
  });

  it("a dropped broadcast is recovered from the gap the next one reveals", async () => {
    const { server, clients: [a, b] } = setup();
    b!.sync.local(move(5, "t2"));
    await b!.sync.flush();
    b!.sync.local(color("#00ff00", "t3"));
    await b!.sync.flush();
    server.hub.deliver("c0", { drop: (_e, i) => i === 0 });
    await settle();
    converged(server, [a!]);
  });

  it("a whole-document write (AI job) makes peers take a snapshot and rebase their pending edits", async () => {
    const { server, clients: [a] } = setup(1);
    a!.sync.local(color("#ff0000"));
    server.writeWhole((d) => applyCommand(d, { type: "updateElement", ref: ref("t2"), props: { content: "Übersetzt" } as never }));
    server.hub.deliver("c0");
    await settle();
    expect(el(a!.doc(), "t2")!.content).toBe("Übersetzt");
    expect(el(a!.doc(), "t1")!.color).toBe("#ff0000");
    await quiesce(server, [a!]);
    converged(server, [a!]);
  });

  it("a rejected command leaves the view and is reported", async () => {
    const { server, clients: [a] } = setup(1);
    a!.sync.local({ type: "updateElement", ref: ref("t1"), props: { size: { width: -5, height: 1 } } as never });
    a!.sync.local(color("#ff0000", "t2"));
    await a!.sync.flush();
    expect(a!.rejected).toHaveLength(1);
    expect(el(a!.doc(), "t1")!.size.width).toBe(40);
    converged(server, [a!]);
  });

  it("losing access stops the engine", async () => {
    const { clients: [a] } = setup(1);
    a!.net.status = 404;
    a!.sync.local(color("#ff0000"));
    expect(await a!.sync.flush()).toBe(false);
    expect(a!.sync.status.state).toBe("stopped");
  });

  it("reset adopts a server document after a doc job", async () => {
    const { server, clients: [a] } = setup(1);
    server.writeWhole((d) => applyCommand(d, color("#abcdef")));
    a!.sync.reset(server.doc, server.head);
    expect(plain(a!.doc())).toEqual(plain(server.doc));
    expect(a!.sync.seq).toBe(server.head);
  });
});

/** Small seeded PRNG so a failing interleaving can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function randomCommand(doc: ChitrapxDoc, r: () => number, n: number): { cmd: Command; transient?: boolean } | null {
  const boards = doc.groups[0]!.boards;
  const board = boards[Math.floor(r() * boards.length)]!;
  const els = board.elements;
  const pick = els[Math.floor(r() * els.length)];
  const target = pick && { groupId: "g", boardId: board.id, elementId: pick.id };
  const roll = r();
  if (roll < 0.1 || !target) return { cmd: { type: "addElement", groupId: "g", boardId: board.id, element: newText(`n${n}`, Math.floor(r() * 200)) } };
  if (roll < 0.3) return { cmd: { type: "moveElements", refs: [target], dx: Math.round(r() * 20 - 10), dy: Math.round(r() * 20 - 10) }, transient: r() < 0.5 };
  if (roll < 0.5) return { cmd: { type: "updateElement", ref: target, props: { color: ["#ff0000", "#00ff00", "#0000ff"][Math.floor(r() * 3)] } as never } };
  if (roll < 0.6) return { cmd: { type: "updateElement", ref: target, props: { content: `text ${n}` } as never } };
  if (roll < 0.68) return { cmd: { type: "deleteElements", refs: [target] } };
  if (roll < 0.78) return { cmd: { type: "reorderElement", ref: target, to: (["front", "back", "forward", "backward"] as const)[Math.floor(r() * 4)]! } };
  if (roll < 0.85) return { cmd: { type: "moveBoard", groupId: "g", boardId: board.id, toIndex: Math.floor(r() * boards.length) } };
  if (roll < 0.92) return { cmd: { type: "updateBoard", groupId: "g", boardId: board.id, props: { backgroundColor: ["#111111", "#eeeeee"][Math.floor(r() * 2)] } } };
  return { cmd: { type: r() < 0.5 ? "addLocale" : "removeLocale", code: "fr-FR" } };
}

describe("convergence (property test)", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`random interleavings of three clients converge (seed ${seed}); the server doc is the fold of its history`, async () => {
      const r = rng(seed);
      const initial = syncDoc();
      const server = new FakeServer(initial);
      const clients = [0, 1, 2].map((i) => client(server, `c${i}`));
      const dragging = new Set<string>();
      for (let step = 0; step < 250; step++) {
        const c = clients[Math.floor(r() * clients.length)]!;
        const roll = r();
        if (roll < 0.5) {
          const next = randomCommand(c.doc(), r, step);
          if (!next) continue;
          const transient = !!next.transient;
          if (!transient && dragging.has(c.id)) { c.sync.gestureEnd(); dragging.delete(c.id); }
          c.sync.local(next.cmd, { transient });
          if (transient) dragging.add(c.id);
        } else if (roll < 0.6) {
          if (dragging.has(c.id)) { c.sync.gestureEnd(); dragging.delete(c.id); }
        } else if (roll < 0.75) {
          await c.sync.flush();
        } else if (roll < 0.88) {
          server.hub.deliver(c.id, { n: Math.ceil(r() * 3), drop: () => r() < 0.1 });
          await settle(2);
        } else if (roll < 0.93) {
          c.net.online = !c.net.online;
        } else if (roll < 0.96) {
          c.net.loseNextResponse = true;
        } else if (roll < 0.98) {
          await c.sync.catchUp();
        } else {
          server.writeWhole((d) => applyCommand(d, { type: "updateBoard", groupId: "g", boardId: "b2", props: { name: `job ${step}` } }));
        }
      }
      for (const c of clients) if (dragging.has(c.id)) c.sync.gestureEnd();
      await quiesce(server, clients);
      converged(server, clients);

      let replay = initial;
      for (const h of server.history) replay = "whole" in h ? h.whole : migrate(applyCommand(replay, h.entry.command));
      expect(plain(replay)).toEqual(plain(server.doc));
    });
  }
});

describe("LiveSync scheduling", () => {
  it("sends on its own after the send delay and reports saving then saved", async () => {
    const server = new FakeServer(syncDoc());
    const states: string[] = [];
    const sync = new LiveSync({
      clientId: "x", doc: syncDoc(), seq: 0, sendDelayMs: 1,
      transport: { submit: async (b) => server.submit(b), fetchSince: async (after, id) => server.since(after, id) },
      onView: () => {}, onStatus: (s) => states.push(s.state),
    });
    sync.local(color("#ff0000"));
    await new Promise((r) => setTimeout(r, 30));
    expect(server.log).toHaveLength(1);
    expect(states).toEqual(["unsaved", "saving", "saved"]);
    sync.stop();
  });
});
