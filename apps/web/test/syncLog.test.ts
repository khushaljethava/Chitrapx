import { describe, expect, it, vi } from "vitest";
import { migrate } from "@chitrapx/document";
import type { Command } from "@/editor/commands.ts";
import { applyBatch, crossedSnapshot, isContiguous, isSafeCommandJson, type SubmitItem } from "@/editor/sync/log.ts";
import { el, ref, syncDoc } from "./support/syncDoc.ts";

const color = (c: string, id = "t1"): Command => ({ type: "updateElement", ref: ref(id), props: { color: c } as never });
const items = (...cmds: Command[]): SubmitItem[] => cmds.map((command, i) => ({ clientSeq: i + 1, command }));
const base = { head: 7, lastClientSeq: null, clientId: "c1", userId: "u1", validate: migrate };

describe("applyBatch", () => {
  it("gives accepted commands consecutive seqs after the head and applies them in order", () => {
    const out = applyBatch({ ...base, doc: syncDoc(), items: items(color("#111111"), color("#222222"), color("#333333", "t2")) });
    expect(out.head).toBe(10);
    expect(out.entries.map((e) => e.seq)).toEqual([8, 9, 10]);
    expect(out.results).toEqual([{ clientSeq: 1, seq: 8 }, { clientSeq: 2, seq: 9 }, { clientSeq: 3, seq: 10 }]);
    expect(el(out.doc, "t1")!.color).toBe("#222222");
    expect(out.entries[0]).toMatchObject({ clientId: "c1", clientSeq: 1, userId: "u1" });
  });

  it("acknowledges duplicates without applying them again", () => {
    const moves: Command = { type: "moveElements", refs: [ref("t1")], dx: 5, dy: 0 };
    const out = applyBatch({ ...base, doc: syncDoc(), lastClientSeq: 2, items: [{ clientSeq: 2, command: moves }, { clientSeq: 3, command: moves }] });
    expect(out.results).toEqual([{ clientSeq: 2, duplicate: true }, { clientSeq: 3, seq: 8 }]);
    expect(el(out.doc, "t1")!.position.x).toBe(5);
  });

  it("rejects a command whose result is invalid and still applies the others", () => {
    const bad: Command = { type: "updateElement", ref: ref("t1"), props: { size: { width: -1, height: 5 } } as never };
    const out = applyBatch({ ...base, doc: syncDoc(), items: items(color("#111111"), bad, color("#333333", "t2")) });
    expect(out.results[0]).toEqual({ clientSeq: 1, seq: 8 });
    expect(out.results[1]).toMatchObject({ clientSeq: 2, error: expect.any(String) });
    expect(out.results[2]).toEqual({ clientSeq: 3, seq: 9 });
    expect(out.entries.map((e) => e.clientSeq)).toEqual([1, 3]);
    expect(el(out.doc, "t1")!.size.width).toBe(40);
    expect(el(out.doc, "t2")!.color).toBe("#333333");
  });

  it("rejects a command that throws", () => {
    const out = applyBatch({ ...base, doc: syncDoc(), items: items({ type: "moveElements", refs: null } as never) });
    expect(out.results[0]).toMatchObject({ error: expect.any(String) });
    expect(out.head).toBe(7);
  });

  it("validates once when the whole batch is fine", () => {
    const validate = vi.fn(migrate);
    applyBatch({ ...base, doc: syncDoc(), validate, items: items(color("#111111"), color("#222222"), color("#333333")) });
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("logs a command whose target is gone as a no-op", () => {
    const out = applyBatch({ ...base, doc: syncDoc(), items: items(color("#111111", "missing")) });
    expect(out.results).toEqual([{ clientSeq: 1, seq: 8 }]);
    expect(out.doc).toEqual(syncDoc());
  });
});

describe("helpers", () => {
  it("isSafeCommandJson refuses prototype keys anywhere", () => {
    expect(isSafeCommandJson(color("#fff"))).toBe(true);
    expect(isSafeCommandJson(JSON.parse('{"type":"updateElement","props":{"__proto__":{"x":1}}}'))).toBe(false);
    expect(isSafeCommandJson({ type: "patch", ops: [{ path: ["constructor"] }] })).toBe(false);
  });

  it("crossedSnapshot fires when the head crosses a multiple of 100", () => {
    expect(crossedSnapshot(99, 100)).toBe(true);
    expect(crossedSnapshot(98, 103)).toBe(true);
    expect(crossedSnapshot(100, 150)).toBe(false);
  });

  it("isContiguous checks the log has every seq up to the head", () => {
    const e = (seq: number) => ({ seq, clientId: "c", clientSeq: seq, userId: null, command: color("#fff") });
    expect(isContiguous(3, 5, [e(4), e(5)])).toBe(true);
    expect(isContiguous(3, 5, [e(5)])).toBe(false);
    expect(isContiguous(3, 3, [])).toBe(true);
  });
});
