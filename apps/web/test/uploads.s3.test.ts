import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuckets, s3Storage, storageConfig } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { completeUpload, signUpload } from "@/server/uploads.ts";

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
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeAll(async () => { await ensureBuckets(storageConfig(), process.env.WEB_ORIGIN ?? "http://localhost:3000"); });

describe("uploads through real S3 (MinIO)", () => {
  it("sign → PUT → complete stores validated bytes; the same URL cannot be used twice; a size lie is refused", async () => {
    const user = await createUser();
    const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id), plan: "free", role: "owner" };
    const app = await createApp(ctx, { name: "S3" });
    const storage = s3Storage();
    const file = png(4, 3);
    const signed = await signUpload(ctx, storage, { appId: app.id, kind: "screenshot", size: file.length, mime: "image/png", sha256: sha(file) });
    if (!("uploadId" in signed)) throw new Error("expected a presigned URL");
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(Buffer.concat([file, Buffer.from("x")])) })).ok).toBe(false);
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(file) })).status).toBe(200);
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(file) })).ok).toBe(false);
    const asset = await completeUpload(ctx, storage, { appId: app.id, kind: "screenshot", sha256: sha(file), uploadId: signed.uploadId });
    expect(asset).toMatchObject({ width: 4, height: 3, mime: "image/png" });
    expect(await storage.download(`${ctx.workspaceId}/${sha(file)}`)).toEqual(file);
  });
});
