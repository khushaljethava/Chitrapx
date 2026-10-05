import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import type { ChitrapxDoc } from "@chitrapx/document";
import { memoryStorage } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { assetUrlMap } from "@/server/projects.ts";
import { completeUpload, deleteReference, listAssets, listReferences, signUpload, stagingPath } from "@/server/uploads.ts";

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
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk("IEND", Buffer.alloc(0))]);
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const rights = { analysisRights: true };

async function setup() {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" };
  return { ctx, app: await createApp(ctx, { name: "A" }), storage: memoryStorage() };
}
type S = Awaited<ReturnType<typeof setup>>;
async function upload(s: S, file: Buffer, kind: "screenshot" | "reference", extra: object = {}) {
  const signed = await signUpload(s.ctx, s.storage, { appId: s.app.id, kind, size: file.length, mime: "image/png", sha256: sha(file), ...extra });
  if ("existing" in signed) return signed.existing;
  await s.storage.put(stagingPath(s.ctx, signed.uploadId), file, "application/octet-stream");
  return completeUpload(s.ctx, s.storage, { appId: s.app.id, kind, sha256: sha(file), uploadId: signed.uploadId, ...extra });
}
const imageDoc = (...ids: string[]) => ({ schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] }, groups: [{ id: "g", target: "iphone-6.9", spanElements: [],
  boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: ids.map((id, i) => ({ id: `i${i}`, type: "image", imageSrc: `asset:${id}`, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1 })) }] }] }) as unknown as ChitrapxDoc;

describe("competitor reference images (SP11)", () => {
  it("need the analysis-rights box, and an app's board holds at most ten", async () => {
    const s = await setup();
    await expect(upload(s, png(2, 2), "reference")).rejects.toMatchObject({ status: 400, code: "analysis_rights_required" });
    for (let i = 1; i <= 10; i++) await upload(s, png(i, 1), "reference", rights);
    await expect(upload(s, png(11, 1), "reference", rights)).rejects.toMatchObject({ status: 409, code: "reference_limit" });
    expect(await upload(s, png(3, 1), "reference", rights)).toMatchObject({ kind: "reference" }); // the same image again is not a new one
  });

  it("never show up as app uploads, editor assets or document sources", async () => {
    const s = await setup();
    const ref = await upload(s, png(3, 3), "reference", rights);
    const shot = await upload(s, png(4, 4), "screenshot");
    expect((await listAssets(s.ctx, s.storage, s.app.id)).map((a) => a.id)).toEqual([shot.id]);
    expect((await listReferences(s.ctx, s.storage, s.app.id)).map((a) => [a.id, a.kind, a.insight])).toEqual([[ref.id, "reference", null]]);
    expect(Object.keys(await assetUrlMap(s.ctx, s.storage, imageDoc(ref.id, shot.id)))).toEqual([`asset:${shot.id}`]);
  });

  it("one file cannot be both a reference and an upload of the same app", async () => {
    const s = await setup();
    const file = png(5, 5);
    await upload(s, file, "screenshot");
    await expect(upload(s, file, "reference", rights)).rejects.toMatchObject({ status: 409, code: "asset_kind_conflict" });
  });

  it("a file another app already has becomes a reference here, not a screenshot", async () => {
    const s = await setup();
    const other = await createApp(s.ctx, { name: "Other" });
    const file = png(6, 6);
    await upload({ ...s, app: other }, file, "screenshot");
    expect(await upload(s, file, "reference", rights)).toMatchObject({ kind: "reference", appId: s.app.id });
  });

  it("deleting a reference deletes its analysis, and its bytes when nothing else uses them", async () => {
    const s = await setup();
    const ref = await upload(s, png(7, 7), "reference", rights);
    await db.insert(schema.referenceInsights).values({ workspaceId: s.ctx.workspaceId, assetId: ref.id, insight: { headline: "x" }, model: "m" });
    await deleteReference(s.ctx, s.storage, s.app.id, ref.id);
    expect(await db.select().from(schema.referenceInsights).where(eq(schema.referenceInsights.assetId, ref.id))).toEqual([]);
    expect(await s.storage.exists(`${s.ctx.workspaceId}/${ref.sha256}`)).toBe(false);
    await expect(deleteReference(s.ctx, s.storage, s.app.id, ref.id)).rejects.toMatchObject({ status: 404 });
  });
  it("the rights check cannot be skipped by signing as a screenshot and completing as a reference (F2)", async () => {
    const s = await setup();
    const file = png(8, 8);
    const signed = await signUpload(s.ctx, s.storage, { appId: s.app.id, kind: "screenshot", size: file.length, mime: "image/png", sha256: sha(file) });
    if ("existing" in signed) throw new Error("expected a fresh upload");
    await s.storage.put(stagingPath(s.ctx, signed.uploadId), file, "application/octet-stream");
    await expect(completeUpload(s.ctx, s.storage, { appId: s.app.id, kind: "reference", sha256: sha(file), uploadId: signed.uploadId }))
      .rejects.toMatchObject({ status: 400, code: "analysis_rights_required" });
  });
});
