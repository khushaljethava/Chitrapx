import { createHash, randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
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
  signed: string[] = [];
  async signUpload(path: string) { this.signed.push(path); return { path, token: "t" }; }
  async download(path: string) { const f = this.files.get(path); if (!f) throw new Error("missing"); return f; }
  async remove(path: string) { this.files.delete(path); }
  async move(from: string, to: string) {
    const f = this.files.get(from);
    if (!f || this.files.has(to)) throw new Error("move failed");
    this.files.set(to, f); this.files.delete(from);
  }
  async signedUrls(paths: string[]) { return paths.map((p) => `mem://${p}`); }
  async signedDownload(path: string) { return `mem://${path}`; }
}

async function setup(plan: Ctx["plan"] = "free") {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, plan), plan };
  const app = await createApp(ctx, { name: "A" });
  return { ctx, app, storage: new MemoryStorage() };
}
const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);

/** Client side of the flow: sign, put bytes at the staging path, complete. */
async function upload(s: Awaited<ReturnType<typeof setup>>, file: Buffer, appId = s.app.id) {
  const signed = await signUpload(s.ctx, s.storage, { appId, kind: "screenshot", size: file.length, mime: "image/png", sha256: sha(file) });
  if ("existing" in signed) return { signed, asset: signed.existing };
  s.storage.files.set(signed.path, file);
  return { signed, asset: await completeUpload(s.ctx, s.storage, { appId, kind: "screenshot", sha256: sha(file), uploadId: signed.uploadId }) };
}

describe("uploads", () => {
  it("signs a one-time staging path, then the server moves validated bytes to the final path", async () => {
    const s = await setup();
    const file = png(3, 2);
    const { signed, asset } = await upload(s, file);
    expect("uploadId" in signed && signed.path).toBe(`${s.ctx.workspaceId}/staging/${"uploadId" in signed ? signed.uploadId : ""}`);
    expect(asset).toMatchObject({ width: 3, height: 2, mime: "image/png", bytes: file.length, storagePath: `${s.ctx.workspaceId}/${sha(file)}` });
    expect(s.storage.files.get(`${s.ctx.workspaceId}/${sha(file)}`)).toEqual(file);
    expect(s.storage.signed.every((p) => p.includes("/staging/"))).toBe(true);
    expect([...s.storage.files.keys()].some((k) => k.includes("/staging/"))).toBe(false);
  });

  it("re-uploading the same image returns the existing asset without a new upload", async () => {
    const s = await setup();
    const file = png(2, 2);
    const first = await upload(s, file);
    const again = await upload(s, file);
    expect(again.signed).toMatchObject({ existing: { id: first.asset.id } });
    expect(s.storage.signed).toHaveLength(1);
  });

  it("a second app reusing a workspace image gets its own row and never an upload token", async () => {
    const s = await setup("pro");
    const app2 = await createApp(s.ctx, { name: "B" });
    const file = png(4, 4);
    const first = await upload(s, file);
    const second = await upload(s, file, app2.id);
    expect(second.signed).toHaveProperty("existing");
    expect(second.asset).toMatchObject({ appId: app2.id, width: 4, storagePath: first.asset.storagePath });
    expect(second.asset.id).not.toBe(first.asset.id);
    expect(s.storage.signed).toHaveLength(1);
  });

  it("rejects oversize and non-image declarations at sign time", async () => {
    const { ctx, app, storage } = await setup();
    const base = { appId: app.id, kind: "screenshot", sha256: "a".repeat(64) };
    expect(await status(signUpload(ctx, storage, { ...base, size: 26 * 1024 * 1024, mime: "image/png" }))).toBe(413);
    expect(await status(signUpload(ctx, storage, { ...base, size: 10, mime: "image/svg+xml" }))).toBe(400);
    expect(await status(signUpload(ctx, storage, { ...base, size: 10, mime: "application/pdf" }))).toBe(400);
  });

  it("rejects bytes that are not an image and removes the staging object", async () => {
    const s = await setup();
    const fake = Buffer.from("definitely not a png");
    const signed = await signUpload(s.ctx, s.storage, { appId: s.app.id, kind: "screenshot", size: fake.length, mime: "image/png", sha256: sha(fake) });
    if (!("uploadId" in signed)) throw new Error("expected a token");
    s.storage.files.set(signed.path, fake);
    expect(await status(completeUpload(s.ctx, s.storage, { appId: s.app.id, kind: "screenshot", sha256: sha(fake), uploadId: signed.uploadId }))).toBe(400);
    expect(s.storage.files.size).toBe(0);
  });

  it("rejects a checksum that does not match and leaves no object behind", async () => {
    const s = await setup();
    const file = png(1, 1);
    const claimed = "b".repeat(64);
    const signed = await signUpload(s.ctx, s.storage, { appId: s.app.id, kind: "screenshot", size: file.length, mime: "image/png", sha256: claimed });
    if (!("uploadId" in signed)) throw new Error("expected a token");
    s.storage.files.set(signed.path, file);
    expect(await status(completeUpload(s.ctx, s.storage, { appId: s.app.id, kind: "screenshot", sha256: claimed, uploadId: signed.uploadId }))).toBe(400);
    expect(s.storage.files.size).toBe(0);
  });

  it("signs URLs from the workspace and hash, never from a stored path", async () => {
    const s = await setup();
    const victim = randomUUID();
    await db.insert(schema.assets).values({ workspaceId: s.ctx.workspaceId, appId: s.app.id, kind: "image", storagePath: `${victim}/secret`, mime: "image/png", bytes: 1, sha256: "c".repeat(64) });
    const [row] = await listAssets(s.ctx, s.storage, s.app.id);
    expect(row!.url).toBe(`mem://${s.ctx.workspaceId}/${"c".repeat(64)}`);
  });

  it("returns 404 for another workspace's app", async () => {
    const { app } = await setup();
    const other = await setup();
    const file = png(1, 1);
    expect(await status(signUpload(other.ctx, other.storage, { appId: app.id, kind: "screenshot", size: file.length, mime: "image/png", sha256: sha(file) }))).toBe(404);
    expect(await status(listAssets(other.ctx, other.storage, app.id))).toBe(404);
  });
});
