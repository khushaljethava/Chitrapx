import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sniffAsset } from "../src/assetCheck.ts";

function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk("IEND", Buffer.alloc(0))]);
}

describe("sniffAsset", () => {
  it("accepts a PNG screenshot and reads its size", async () => {
    expect(await sniffAsset("screenshot", png(3, 5))).toEqual({ ok: true, mime: "image/png", width: 3, height: 5 });
  });
  it("rejects bytes of a type the kind does not accept, including SVG", async () => {
    expect(await sniffAsset("image", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ ok: false, code: "unsupported_type" });
    expect(await sniffAsset("recording", png(3, 5))).toEqual({ ok: false, code: "unsupported_type" });
  });
});
