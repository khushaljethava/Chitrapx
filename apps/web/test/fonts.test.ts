import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { memoryStorage } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { fixtureFont as font, withFsType } from "../../../packages/db/test/fontFixtures.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { deleteFont, listFonts } from "@/server/fonts.ts";
import { completeUpload, signUpload, stagingPath } from "@/server/uploads.ts";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

async function setup() {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" };
  return { ctx, storage: memoryStorage() };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Browser side: sign (with the rights checkbox), PUT the bytes, complete. */
async function uploadFont(s: S, bytes: Buffer, extra: Record<string, unknown> = {}) {
  const signed = await signUpload(s.ctx, s.storage, { kind: "font", size: bytes.length, mime: "application/x-font-ttf", sha256: sha(bytes), embedRights: true, ...extra });
  if ("existing" in signed) return signed.existing;
  await s.storage.put(stagingPath(s.ctx, signed.uploadId), bytes, "application/octet-stream");
  return completeUpload(s.ctx, s.storage, { kind: "font", sha256: sha(bytes), uploadId: signed.uploadId });
}
const projectUsing = async (s: S, appName: string, family: string) => {
  const app = await createApp(s.ctx, { name: appName });
  const doc = { schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] }, groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: [{ id: "t", type: "text", content: "Hi", fontSize: 40, color: "#000", fontFamily: family, position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, rotation: 0, scale: 1 }] }] }] };
  const [p] = await db.insert(schema.projects).values({ workspaceId: s.ctx.workspaceId, appId: app.id, name: `Uses ${family}`, kind: "screenshots", doc }).returning();
  return p!;
};

describe("font uploads", () => {
  it("stores a workspace font (no app), typed by its bytes, under a non-clashing family", async () => {
    const s = await setup();
    const bytes = font("inter-400.woff2");
    const asset = await uploadFont(s, bytes);
    expect(asset).toMatchObject({ appId: null, kind: "font", mime: "font/woff2", bytes: bytes.length, meta: { family: "Inter (custom)", weight: 400, italic: false, format: "woff2" } });
    expect(s.storage.types.get(`uploads/${s.ctx.workspaceId}/${sha(bytes)}`)).toBe("font/woff2");
  });

  it("needs the embedding-rights confirmation and a size within 10 MB", async () => {
    const s = await setup();
    const bytes = font("inter-400.woff2");
    expect(await code(signUpload(s.ctx, s.storage, { kind: "font", size: bytes.length, sha256: sha(bytes) }))).toBe("embed_rights_required");
    expect(await status(signUpload(s.ctx, s.storage, { kind: "font", size: 11 * 1024 * 1024, sha256: sha(bytes), embedRights: true }))).toBe(413);
  });

  it("rejects a renamed .exe or SVG, a restricted licence and unreadable bytes, keeping nothing", async () => {
    const s = await setup();
    expect(await code(uploadFont(s, Buffer.from("MZ\x90\0\x03\0\0\0 not a font")))).toBe("unsupported_type");
    expect(await code(uploadFont(s, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")))).toBe("unsupported_type");
    expect(await code(uploadFont(s, withFsType(font("inter-400.ttf"), 2)))).toBe("font_restricted");
    expect(await code(uploadFont(s, Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(64, 1)])))).toBe("font_unreadable");
    expect(s.storage.files.size).toBe(0);
    expect(await listFonts(s.ctx, s.storage)).toEqual([]);
  });

  it("returns the existing face for the same file; refuses a second file for the same face", async () => {
    const s = await setup();
    const first = await uploadFont(s, font("inter-400.woff2"));
    expect((await uploadFont(s, font("inter-400.woff2"))).id).toBe(first.id);
    expect(await code(uploadFont(s, font("inter-400.ttf")))).toBe("font_face_exists"); // same family, 400, upright
  });

  it("groups faces into families and lists them with signed URLs", async () => {
    const s = await setup();
    await uploadFont(s, font("inter-700.woff2"));
    await uploadFont(s, font("inter-400.woff2"));
    await uploadFont(s, font("pacifico.woff2"));
    const fonts = await listFonts(s.ctx, s.storage);
    expect(fonts.map((f) => [f.family, f.faces.map((x) => x.weight)])).toEqual([["Inter (custom)", [400, 700]], ["Pacifico (custom)", [400]]]);
    expect(fonts[0]!.faces[0]!.url).toMatch(/^memory:\/\/uploads\//);
  });

  it("enforces 20 faces or 50 MB per workspace at sign time, with counts in the message", async () => {
    const s = await setup();
    await db.insert(schema.assets).values(Array.from({ length: 20 }, (_, i) => ({ workspaceId: s.ctx.workspaceId, appId: null, kind: "font" as const,
      storagePath: `x/${i}`, mime: "font/woff2", bytes: 1000, sha256: String(i).padStart(64, "0"), meta: { family: `F${i}`, weight: 400, italic: false, format: "woff2" as const } })));
    const bytes = font("pacifico.woff2");
    await expect(signUpload(s.ctx, s.storage, { kind: "font", size: bytes.length, sha256: sha(bytes), embedRights: true }))
      .rejects.toMatchObject({ status: 403, code: "font_quota", message: expect.stringContaining("20 of 20 fonts") });
  });

  it("blocks deleting the last face of a family a project uses, in any app of the workspace", async () => {
    const s = await setup();
    const face = await uploadFont(s, font("pacifico.woff2"));
    const p = await projectUsing(s, "Other app", "Pacifico (custom)");
    await expect(deleteFont(s.ctx, s.storage, face.id)).rejects.toMatchObject({ status: 409, code: "font_in_use", details: { projects: [{ id: p.id, name: p.name }] } });
    expect(s.storage.files.size).toBe(1);
  });

  it("deletes one face of a family that keeps another, and an unused face with its object", async () => {
    const s = await setup();
    const regular = await uploadFont(s, font("inter-400.woff2"));
    const bold = await uploadFont(s, font("inter-700.woff2"));
    await projectUsing(s, "App", "Inter (custom)");
    await deleteFont(s.ctx, s.storage, bold.id);
    expect((await listFonts(s.ctx, s.storage))[0]!.faces.map((f) => f.assetId)).toEqual([regular.id]);
    const lone = await uploadFont(s, font("pacifico.woff2"));
    await deleteFont(s.ctx, s.storage, lone.id);
    expect(await s.storage.exists(`${s.ctx.workspaceId}/${sha(font("pacifico.woff2"))}`)).toBe(false);
  });

  it("two files for the same face uploaded at once: one is stored, the other refused (M1)", async () => {
    const s = await setup();
    const out = await Promise.allSettled([uploadFont(s, font("inter-400.woff2")), uploadFont(s, font("inter-400.ttf"))]);
    expect(out.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "font_face_exists" });
    expect((await listFonts(s.ctx, s.storage))[0]!.faces).toHaveLength(1);
    expect(s.storage.files.size).toBe(1);
  });

  it("a font is never linked into an app, and deleting it keeps bytes another row shares (M2)", async () => {
    const s = await setup();
    const bytes = font("pacifico.woff2");
    const face = await uploadFont(s, bytes);
    const app = await createApp(s.ctx, { name: "App" });
    const signed = await signUpload(s.ctx, s.storage, { appId: app.id, kind: "image", size: bytes.length, mime: "image/png", sha256: sha(bytes) });
    expect("existing" in signed).toBe(false);
    await db.insert(schema.assets).values({ workspaceId: s.ctx.workspaceId, appId: app.id, kind: "image", storagePath: `${s.ctx.workspaceId}/${sha(bytes)}`, mime: "image/png", bytes: bytes.length, sha256: sha(bytes) });
    await deleteFont(s.ctx, s.storage, face.id);
    expect(await s.storage.exists(`${s.ctx.workspaceId}/${sha(bytes)}`)).toBe(true);
  });

  it("two deletes at once cannot remove both faces of a family in use (M4)", async () => {
    const s = await setup();
    const regular = await uploadFont(s, font("inter-400.woff2"));
    const bold = await uploadFont(s, font("inter-700.woff2"));
    await projectUsing(s, "App", "Inter (custom)");
    const out = await Promise.allSettled([deleteFont(s.ctx, s.storage, regular.id), deleteFont(s.ctx, s.storage, bold.id)]);
    expect(out.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await listFonts(s.ctx, s.storage))[0]!.faces).toHaveLength(1);
  });

  it("another workspace cannot see or delete my fonts", async () => {
    const mine = await setup();
    const face = await uploadFont(mine, font("pacifico.woff2"));
    const other = await setup();
    expect(await listFonts(other.ctx, other.storage)).toEqual([]);
    expect(await status(deleteFont(other.ctx, other.storage, face.id))).toBe(404);
  });
});
