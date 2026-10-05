import { describe, expect, it } from "vitest";
import { memoryStorage } from "../src/index.ts";
import { storageContract } from "./contract.ts";

storageContract("memory", () => memoryStorage(), false);

describe("memoryStorage", () => {
  it("records presigned paths and hands out memory:// URLs", async () => {
    const s = memoryStorage();
    const { url, headers } = await s.presignPut("staging/w/u", { contentType: "image/png", contentLength: 3 });
    expect(url).toBe("memory://uploads/staging/w/u?put");
    expect(headers).toEqual({ "Content-Type": "image/png", "If-None-Match": "*" });
    expect(s.signed).toEqual(["staging/w/u"]);
    expect(await s.signedUrls(["w/abc"])).toEqual(["memory://uploads/w/abc"]);
  });
});
