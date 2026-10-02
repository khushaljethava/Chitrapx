import { describe, expect, it } from "vitest";
import { readJsonLimited } from "@/server/http.ts";

const streamed = (chunks: string[]) => new Request("http://x", {
  method: "PUT",
  body: new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }),
  // @ts-expect-error -- Node needs duplex for streamed request bodies
  duplex: "half",
});

describe("readJsonLimited", () => {
  it("parses bodies under the limit", async () => {
    expect(await readJsonLimited(streamed(['{"a":', "1}"]), 100)).toEqual({ a: 1 });
  });
  it("refuses an over-limit body with 413 even without Content-Length, and lying headers", async () => {
    await expect(readJsonLimited(streamed(["x".repeat(60), "x".repeat(60)]), 100)).rejects.toMatchObject({ status: 413 });
    const lying = new Request("http://x", { method: "PUT", body: "y".repeat(200), headers: { "content-length": "5" } });
    await expect(readJsonLimited(lying, 100)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects malformed JSON with 400", async () => {
    await expect(readJsonLimited(streamed(["{nope"]), 100)).rejects.toMatchObject({ status: 400 });
  });
});
