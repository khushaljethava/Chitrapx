import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportError } from "@/editor/sync/engine.ts";
import { colorFor, initials, parseCursor, parsePreview, peersFrom, PALETTE, throttle, unknownAssetIds } from "@/editor/live/presence.ts";
import { httpTransport } from "@/editor/live/transport.ts";
import { syncDoc } from "./support/syncDoc.ts";

const peer = (clientId: string, name = "Ann", userId = "u1") => ({
  clientId, userId, name, avatarUrl: null, color: colorFor(userId), groupId: "g", boardId: "b1", selection: ["t1"], canEdit: true,
});

describe("presence helpers", () => {
  it("gives each user a stable colour from the palette", () => {
    expect(colorFor("user-a")).toBe(colorFor("user-a"));
    expect(PALETTE).toContain(colorFor("user-b"));
  });

  it("lists other sessions from Supabase presence state, newest meta per client, never this one", () => {
    const state = {
      me: [{ presence_ref: "1", ...peer("me", "Me", "u0") }],
      c2: [{ presence_ref: "2", ...peer("c2", "Zed", "u2") }],
      c1: [{ presence_ref: "3", ...peer("c1", "Ann", "u1") }, { presence_ref: "4", ...peer("c1", "Ann B", "u1") }],
      junk: [{ presence_ref: "5", name: 3 }],
    };
    const peers = peersFrom(state, "me");
    expect(peers.map((p) => p.clientId)).toEqual(["c1", "c2"]);
    expect(peers[0]!.name).toBe("Ann B");
  });

  it("parses peer cursors and previews defensively", () => {
    expect(parseCursor({ clientId: "c", groupId: "g", x: 1, y: 2 })).toMatchObject({ clientId: "c", x: 1, y: 2 });
    expect(parseCursor({ clientId: "c", groupId: "g", x: "1", y: 2 })).toBeNull();
    expect(parsePreview({ clientId: "c", groupId: "g", boxes: [{ elementId: "e", x: 0, y: 0, w: 5, h: 5, rotation: 0 }, { x: "bad" }] })!.boxes).toHaveLength(1);
    expect(parsePreview(null)).toBeNull();
  });

  it("initials from a name or an email", () => {
    expect(initials("Ann Lee")).toBe("AL");
    expect(initials("zed@example.com")).toBe("Z");
    expect(initials("")).toBe("?");
  });

  it("throttle runs the first call now and the last one after the window", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 60);
    t(1); t(2); t(3);
    expect(fn.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(60);
    expect(fn.mock.calls).toEqual([[1], [3]]);
    vi.useRealTimers();
  });

  it("finds asset sources this editor has no URL for", () => {
    const doc = syncDoc();
    const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
    (doc.groups[0]!.boards[0]!.elements[0] as unknown as Record<string, unknown>).imageSrc = `asset:${a}`;
    (doc.groups[0]!.boards[1]! as unknown as Record<string, unknown>).backgroundImage = `asset:${b}`;
    expect(unknownAssetIds(doc, (src) => (src === `asset:${a}` ? "https://x" : null))).toEqual([b]);
  });
});

describe("httpTransport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts batches and fetches catch-ups from the commands route", async () => {
    const fetch = vi.fn(async () => Response.json({ head: 1, entries: [], results: [] }));
    vi.stubGlobal("fetch", fetch);
    const t = httpTransport("p1");
    await t.submit({ clientId: "c", after: 0, commands: [] });
    await t.fetchSince(4, "c");
    expect(fetch.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(["/api/projects/p1/commands", "/api/projects/p1/commands?after=4&clientId=c"]);
  });

  it("maps HTTP errors and network failures to TransportError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "nope" }, { status: 404 })));
    await expect(httpTransport("p").fetchSince(0, "c")).rejects.toMatchObject({ status: 404, message: "nope" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await httpTransport("p").submit({ clientId: "c", after: 0, commands: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect(err.status).toBeNull();
  });
});
