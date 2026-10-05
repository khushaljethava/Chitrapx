import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ObjectMissingError, type ObjectStorage } from "../src/index.ts";

const read = async (s: ReadableStream<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  const r = s.getReader();
  for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
  return Buffer.concat(chunks);
};

/** Behaviour every ObjectStorage must have. `http` = its URLs are real and fetchable. */
export function storageContract(name: string, make: () => ObjectStorage, http: boolean) {
  describe(`${name}: object storage contract`, () => {
    const key = () => `test/${randomUUID()}/obj`;

    it("puts, reads back, streams, checks and removes an object", async () => {
      const s = make(); const k = key(); const bytes = Buffer.from("hello storage");
      expect(await s.exists(k)).toBe(false);
      await s.put(k, bytes, "text/plain");
      expect(await s.exists(k)).toBe(true);
      expect(Buffer.from(await s.download(k))).toEqual(bytes);
      expect(await read(await s.downloadStream(k))).toEqual(bytes);
      await s.remove(k);
      expect(await s.exists(k)).toBe(false);
    });

    it("reports a missing object as ObjectMissingError", async () => {
      const s = make();
      await expect(s.download(key())).rejects.toBeInstanceOf(ObjectMissingError);
      await expect(s.downloadStream(key())).rejects.toBeInstanceOf(ObjectMissingError);
    });

    it("move refuses an existing target, otherwise moves", async () => {
      const s = make(); const a = key(), b = key();
      await s.put(a, Buffer.from("a"), "text/plain");
      await s.put(b, Buffer.from("b"), "text/plain");
      await expect(s.move(a, b)).rejects.toThrow();
      expect((await s.download(b)).toString()).toBe("b");
      await s.remove(b);
      await s.move(a, b, { contentType: "font/woff2" });
      expect(await s.exists(a)).toBe(false);
      expect((await s.download(b)).toString()).toBe("a");
    });

    it("keeps the two buckets apart", async () => {
      const s = make(); const k = key();
      await s.put(k, Buffer.from("x"), "application/zip", "exports");
      expect(await s.exists(k)).toBe(false);
      expect(await s.exists(k, "exports")).toBe(true);
    });

    if (http) {
      it("signed GET URLs serve the object", async () => {
        const s = make(); const k = key();
        await s.put(k, Buffer.from("served"), "text/plain");
        const [url] = await s.signedUrls([k]);
        expect(await (await fetch(url!)).text()).toBe("served");
      });

      it("a presigned PUT creates the object once, at exactly the signed size", async () => {
        const s = make(); const k = key(); const body = Buffer.from("x".repeat(100));
        const { url, headers } = await s.presignPut(k, { contentType: "application/octet-stream", contentLength: body.length });
        expect((await fetch(url, { method: "PUT", headers, body: body.subarray(0, 50) })).ok).toBe(false); // size mismatch
        expect((await fetch(url, { method: "PUT", headers, body })).status).toBe(200);
        expect((await fetch(url, { method: "PUT", headers, body })).ok).toBe(false); // If-None-Match: * — never overwrites
        expect(Buffer.from(await s.download(k))).toEqual(body);
      });

      it("signedDownload asks the browser to save under the given name", async () => {
        const s = make(); const k = key();
        await s.put(k, Buffer.from("zip"), "application/zip", "exports");
        const res = await fetch(await s.signedDownload(k, "chitrapx-export.zip"));
        expect(res.headers.get("content-disposition")).toContain('filename="chitrapx-export.zip"');
      });
    }
  });
}
