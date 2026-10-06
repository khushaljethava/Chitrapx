import { describe, expect, it } from "vitest";
import { applyCommand, type Command } from "@/editor/commands.ts";
import {
  addLocal, applySnapshot, dropRejected, hold, initSync, integrate, markInflight, releaseHeld, resetSync, type SyncState,
} from "@/editor/sync/core.ts";
import type { LogEntry } from "@/editor/sync/log.ts";
import { el, plain, ref, syncDoc } from "./support/syncDoc.ts";

const color = (c: string, id = "t1"): Command => ({ type: "updateElement", ref: ref(id), props: { color: c } as never });
const typed = (content: string): Command => ({ type: "updateElement", ref: ref("t1"), props: { content } as never });
const move = (dx: number, id = "t1"): Command => ({ type: "moveElements", refs: [ref(id)], dx, dy: 0 });
const entry = (seq: number, command: Command, clientId = "B", clientSeq = seq): LogEntry => ({ seq, clientId, clientSeq, userId: null, command });
const start = (): SyncState => initSync({ clientId: "A", doc: syncDoc(), seq: 0 });

describe("sync core", () => {
  it("keeps pending local commands on top of remote entries (rebase)", () => {
    let s = addLocal(start(), color("#ff0000"));
    const r = integrate(s, [entry(1, move(30, "t2"))]);
    s = r.state;
    expect(r.gap).toBe(false);
    expect(s.seq).toBe(1);
    expect(s.pending).toHaveLength(1);
    expect(el(s.view, "t1")!.color).toBe("#ff0000");
    expect(el(s.view, "t2")!.position.x).toBe(80);
    expect(el(s.confirmed, "t1")!.color).toBe("#000000");
  });

  it("a remote write to the same property is overridden locally until our command is ordered", () => {
    let s = addLocal(start(), color("#ff0000"));
    s = integrate(s, [entry(1, color("#00ff00"))]).state;
    expect(el(s.view, "t1")!.color).toBe("#ff0000");
    s = integrate(s, [entry(2, color("#ff0000"), "A", 1)]).state;
    expect(s.pending).toEqual([]);
    expect(plain(s.view)).toEqual(plain(s.confirmed));
  });

  it("our own entries pop pending and keep the view as it was", () => {
    let s = addLocal(addLocal(start(), color("#ff0000")), color("#00ff00", "t2"));
    const before = s.view;
    s = integrate(s, [entry(1, color("#ff0000"), "A", 1)]).state;
    expect(s.pending.map((p) => p.clientSeq)).toEqual([2]);
    expect(s.view).toBe(before);
  });

  it("reports a gap and stops at it; old entries are ignored", () => {
    const s = start();
    const r = integrate(s, [entry(2, color("#ff0000"))]);
    expect(r.gap).toBe(true);
    expect(r.state.seq).toBe(0);
    const ok = integrate(integrate(s, [entry(1, move(1))]).state, [entry(1, move(1)), entry(2, move(1))]).state;
    expect(ok.seq).toBe(2);
    expect(el(ok.view, "t1")!.position.x).toBe(2);
  });

  it("a snapshot drops pending commands the server already has", () => {
    let s = addLocal(addLocal(start(), move(5)), move(7, "t2"));
    const server = applyCommand(applyCommand(syncDoc(), move(100, "t3")), move(5));
    s = applySnapshot(s, server, 9, 1);
    expect(s.seq).toBe(9);
    expect(s.pending.map((p) => p.clientSeq)).toEqual([2]);
    expect(el(s.view, "t1")!.position.x).toBe(5);
    expect(el(s.view, "t2")!.position.x).toBe(57);
    expect(applySnapshot(s, syncDoc(), 3, null)).toBe(s);
  });

  it("drops rejected commands from the view", () => {
    let s = addLocal(addLocal(start(), color("#ff0000")), color("#00ff00", "t2"));
    s = dropRejected(s, [1]);
    expect(el(s.view, "t1")!.color).toBe("#000000");
    expect(el(s.view, "t2")!.color).toBe("#00ff00");
  });

  it("coalesces a typing burst and a run of moves into one command each", () => {
    let s = start();
    for (const c of ["H", "He", "Hel"]) s = addLocal(s, typed(c));
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]!.command).toMatchObject({ props: { content: "Hel" } });
    s = addLocal(addLocal(s, move(3, "t2")), move(4, "t2"));
    expect(s.pending).toHaveLength(2);
    expect(s.pending[1]!.command).toMatchObject({ dx: 7 });
    expect(s.nextClientSeq).toBe(3);
  });

  it("never merges into a command that may already be at the server", () => {
    let s = addLocal(start(), typed("H"));
    s = markInflight(s, s.pending[0]!.clientSeq);
    s = addLocal(s, typed("He"));
    expect(s.pending).toHaveLength(2);
  });

  it("refuses a merge that would change the result", () => {
    const marked = applyCommand(syncDoc(), {
      type: "updateElement", ref: ref("t1"), props: { content: "hello world", marks: [{ start: 6, end: 11, color: "#ff0000" }] } as never,
    });
    let s = initSync({ clientId: "A", doc: marked, seq: 0 });
    s = addLocal(addLocal(s, typed("hello")), typed("hello world"));
    expect(s.pending).toHaveLength(2);
  });

  it("holds transient drag commands out of pending until release, then sends them as one", () => {
    let s = start();
    for (let i = 0; i < 5; i++) s = hold(s, move(2));
    expect(s.pending).toEqual([]);
    expect(el(s.view, "t1")!.position.x).toBe(10);
    s = integrate(s, [entry(1, color("#00ff00"))]).state;
    expect(el(s.view, "t1")!.position.x).toBe(10);
    s = releaseHeld(s);
    expect(s.held).toEqual([]);
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]!.command).toMatchObject({ dx: 10 });
  });

  it("a non-transient command releases held ones first", () => {
    let s = hold(start(), move(2));
    s = addLocal(s, color("#ff0000"));
    expect(s.pending.map((p) => p.command.type)).toEqual(["moveElements", "updateElement"]);
  });

  it("reset adopts a server document and forgets local state", () => {
    const s = resetSync(addLocal(start(), color("#ff0000")), syncDoc(), 12);
    expect(s).toMatchObject({ seq: 12, pending: [], held: [] });
  });
});
