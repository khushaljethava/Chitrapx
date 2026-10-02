import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import type { ObjectStorage } from "@/server/storage.ts";
import { completeUpload, listAssets, signUpload } from "@/server/uploads.ts";

/** A valid w x h RGB PNG built from stdlib only. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

class MemoryStorage implements ObjectStorage {
  files = new Map<string, Buffer>();
  async signUpload(path: string) { return { path, token: "t" }; }
  async download(path: string) { const f = this.files.get(path); if (!f) throw new Error("missing"); return f; }
  async remove(path: string) { this.files.delete(path); }
  async signedUrls(paths: string[]) { return paths.map((p) => `mem://${p}`); }
}

async function setup() {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id), plan: "free" };
  const app = await createApp(ctx, { name: "A" });
  return { ctx, app, storage: new MemoryStorage() };
}
const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);

describe("uploads", () => {
  it("stores a real PNG once with its dimensions, and reports the existing asset on re-upload", async () => {
    const { ctx, app, storage } = await setup();
    const file = png(3, 2);
    const signed = await signUpload(ctx, storage, { appId: app.id, kind: "screenshot", size: file.length, mime: "image/png", sha256: sha(file) });
    expect(signed).toMatchObject({ path: `${ctx.workspaceId}/${sha(file)}` });
    storage.files.set(`${ctx.workspaceId}/${sha(file)}`, file);

    const a1 = await completeUpload(ctx, storage, { appId: app.id, kind: "screenshot", sha256: sha(file) });
    const a2 = await completeUpload(ctx, storage, { appId: app.id, kind: "screenshot", sha256: sha(file) });
    expect(a1).toMatchObject({ width: 3, height: 2, mime: "image/png", bytes: file.length });
    expect(a2.id).toBe(a1.id);

    const again = await signUpload(ctx, storage, { appId: app.id, kind: "screenshot", size: file.length, mime: "image/png", sha256: sha(file) });
    expect(again).toMatchObject({ existing: { id: a1.id } });
    const list = await listAssets(ctx, storage, app.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.url).toBe(`mem://${ctx.workspaceId}/${sha(file)}`);
  });

  it("rejects oversize and non-image declarations at sign time", async () => {
    const { ctx, app, storage } = await setup();
    const base = { appId: app.id, kind: "screenshot", sha256: "a".repeat(64) };
    expect(await status(signUpload(ctx, storage, { ...base, size: 26 * 1024 * 1024, mime: "image/png" }))).toBe(413);
    expect(await status(signUpload(ctx, storage, { ...base, size: 10, mime: "image/svg+xml" }))).toBe(400);
    expect(await status(signUpload(ctx, storage, { ...base, size: 10, mime: "application/pdf" }))).toBe(400);
  });

  it("rejects bytes that are not an image and removes the object", async () => {
    const { ctx, app, storage } = await setup();
    const fake = Buffer.from("definitely not a png");
    const path = `${ctx.workspaceId}/${sha(fake)}`;
    storage.files.set(path, fake);
    expect(await status(completeUpload(ctx, storage, { appId: app.id, kind: "screenshot", sha256: sha(fake) }))).toBe(400);
    expect(storage.files.has(path)).toBe(false);
  });

  it("rejects a checksum that does not match the uploaded bytes", async () => {
    const { ctx, app, storage } = await setup();
    const file = png(1, 1);
    const claimed = "b".repeat(64);
    storage.files.set(`${ctx.workspaceId}/${claimed}`, file);
    expect(await status(completeUpload(ctx, storage, { appId: app.id, kind: "screenshot", sha256: claimed }))).toBe(400);
    expect(storage.files.has(`${ctx.workspaceId}/${claimed}`)).toBe(false);
  });

  it("returns 404 for another workspace's app", async () => {
    const { app } = await setup();
    const other = await setup();
    const file = png(1, 1);
    expect(await status(signUpload(other.ctx, other.storage, { appId: app.id, kind: "screenshot", size: file.length, mime: "image/png", sha256: sha(file) }))).toBe(404);
    expect(await status(listAssets(other.ctx, other.storage, app.id))).toBe(404);
  });
});
