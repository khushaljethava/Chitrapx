import { describe, expect, it, vi } from "vitest";
import type { LogEntry } from "@/editor/sync/log.ts";
import { broadcastEntries, broadcastHead, docTopic, liveTopic, restBroadcaster } from "@/server/realtime.ts";

describe("Realtime broadcast (server only)", () => {
  it("posts a private message to the REST broadcast endpoint with the service key", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    const send = restBroadcaster({ url: "https://x.supabase.co", key: "service-key", fetch });
    await send("project:abc", "head", { head: 3 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/realtime/v1/api/broadcast");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: "service-key", authorization: "Bearer service-key" });
    expect(JSON.parse(String(init.body))).toEqual({ messages: [{ topic: "project:abc", event: "head", payload: { head: 3 }, private: true }] });
  });

  it("never throws: a failed or refused broadcast is only logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(restBroadcaster({ url: "https://x", key: "k", fetch: async () => { throw new Error("down"); } })("t", "e", {})).resolves.toBeUndefined();
    await expect(restBroadcaster({ url: "https://x", key: "k", fetch: async () => new Response("no", { status: 403 }) })("t", "e", {})).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("sends entries on the document topic, or only the head when they are too large", async () => {
    const sent: Array<[string, string, unknown]> = [];
    const send = async (t: string, e: string, p: unknown) => { sent.push([t, e, p]); };
    const entry = (n: number): LogEntry => ({ seq: n, clientId: "c", clientSeq: n, userId: null, command: { type: "setMirrorRtl", on: true } });
    await broadcastEntries("p1", 2, [entry(1), entry(2)], send);
    const big: LogEntry = { ...entry(3), command: { type: "setTexts", texts: [{ id: "x", text: "y".repeat(200_000) }] } };
    await broadcastEntries("p1", 3, [big], send);
    await broadcastHead("p1", 4, send);
    expect(sent.map(([t, e]) => `${t} ${e}`)).toEqual(["project:p1 commands", "project:p1 head", "project:p1 head"]);
    expect(sent[1]![2]).toEqual({ head: 3 });
    expect(docTopic("p1")).toBe("project:p1");
    expect(liveTopic("p1")).toBe("project-live:p1");
  });
});
