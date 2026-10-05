import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { STAGING_PREFIX } from "@chitrapx/storage";
import { ACCEPTED, checkFont, db, fontFamilyFor, FontRejected, HEAD_BYTES, lockWorkspace, schema, sniffAsset, sniffFontType, UPLOAD_LIMITS, withTx } from "@chitrapx/db";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { assertFontQuota, bytesInUse, faceExists, faceTaken, findWorkspaceFont } from "./fonts.ts";
import { badRequest, HttpError } from "./http.ts";
import type { ObjectStorage } from "./storage.ts";

export { UPLOAD_LIMITS };

const uploadKind = z.enum(["screenshot", "image", "recording", "font"]);
type UploadKind = z.infer<typeof uploadKind>;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
// Fonts belong to the workspace (no appId); everything else to an app. The client's mime is ignored for fonts.
const signInput = z.object({
  appId: z.uuid().optional(), kind: uploadKind, size: z.number().int().positive(), mime: z.string().max(200).default(""), sha256,
  embedRights: z.boolean().optional(),
});
const completeInput = z.object({ appId: z.uuid().optional(), kind: uploadKind, sha256, uploadId: z.uuid() });
const FONT_ERRORS = {
  font_restricted: "This font's licence does not allow embedding.",
  font_unreadable: "This file could not be read as a font.",
} as const;

export type Asset = typeof schema.assets.$inferSelect;

const tooLarge = (kind: UploadKind) => new HttpError(413, "too_large", `Files of this type can be up to ${UPLOAD_LIMITS[kind] / (1024 * 1024)} MB`);
/** Validated bytes live once per workspace here; asset rows are per app. Always derived, never read from a row. */
const finalPath = (ctx: Ctx, hash: string) => `${ctx.workspaceId}/${hash}`;
/** Clients only ever get a URL for a fresh staging key, so they can never touch validated bytes. The prefix carries the 1-day lifecycle rule. */
export const stagingPath = (ctx: Ctx, uploadId: string) => `${STAGING_PREFIX}${ctx.workspaceId}/${uploadId}`;

/** An app asset with these bytes. Workspace fonts never count, so a font row is never linked into an app. */
async function findAsset(ctx: Ctx, hash: string, appId?: string) {
  const [asset] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.sha256, hash), ne(schema.assets.kind, "font"),
    appId ? eq(schema.assets.appId, appId) : undefined,
  )).limit(1);
  return asset;
}

/** Adds an asset row for `appId` that reuses bytes this workspace already validated. */
async function linkExisting(ctx: Ctx, appId: string, from: Asset): Promise<Asset> {
  const { id: _id, createdAt: _c, ...copy } = from;
  await db.insert(schema.assets).values({ ...copy, appId }).onConflictDoNothing();
  return (await findAsset(ctx, from.sha256, appId))!;
}

export async function signUpload(ctx: Ctx, storage: ObjectStorage, raw: unknown):
  Promise<{ existing: Asset } | { uploadId: string; url: string; headers: Record<string, string> }> {
  const input = signInput.parse(raw);
  if (input.kind === "font") return signFont(ctx, storage, input);
  if (!input.appId) throw badRequest("app_required");
  const appId = input.appId;
  await getApp(ctx, appId);
  if (input.size > UPLOAD_LIMITS[input.kind]) throw tooLarge(input.kind);
  if (!ACCEPTED[input.kind].includes(input.mime)) throw badRequest("unsupported_type");

  const mine = await findAsset(ctx, input.sha256, appId);
  if (mine) return { existing: mine };
  const sibling = await findAsset(ctx, input.sha256);
  if (sibling) return { existing: await linkExisting(ctx, appId, sibling) };

  const uploadId = randomUUID();
  return { uploadId, ...(await storage.presignPut(stagingPath(ctx, uploadId), { contentType: input.mime, contentLength: input.size })) };
}

/**
 * Streams a staged upload: hash and size are computed as bytes arrive, only the head is kept.
 * On any failure the staging object is removed and an HttpError thrown.
 */
async function readStaged(storage: ObjectStorage, staging: string, kind: UploadKind, expectedSha: string): Promise<{ head: Buffer; size: number }> {
  const discard = () => storage.remove(staging).catch(() => {});
  const reject = async (err: HttpError): Promise<never> => { await discard(); throw err; };
  const stream = await storage.downloadStream(staging).catch(() => { throw badRequest("upload_missing"); });
  const reader = stream.getReader();
  const hash = createHash("sha256");
  const head: Uint8Array[] = [];
  let size = 0, headSize = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > UPLOAD_LIMITS[kind]) { await reader.cancel(); return reject(tooLarge(kind)); }
    hash.update(value);
    if (headSize < HEAD_BYTES[kind]) { head.push(value); headSize += value.byteLength; }
  }
  if (size === 0) return reject(badRequest("unsupported_type"));
  if (hash.digest("hex") !== expectedSha) return reject(badRequest("checksum_mismatch"));
  return { head: Buffer.concat(head), size };
}

/** Validates the uploaded bytes themselves (the client's size, type and checksum are never trusted), then publishes them. */
export async function completeUpload(ctx: Ctx, storage: ObjectStorage, raw: unknown): Promise<Asset> {
  const input = completeInput.parse(raw);
  if (input.kind === "font") return completeFont(ctx, storage, input);
  if (!input.appId) throw badRequest("app_required");
  const appId = input.appId;
  await getApp(ctx, appId);
  const staging = stagingPath(ctx, input.uploadId);
  const discard = () => storage.remove(staging).catch(() => {});

  const mine = await findAsset(ctx, input.sha256, appId);
  if (mine) { await discard(); return mine; }

  const { head: headBytes, size } = await readStaged(storage, staging, input.kind, input.sha256);
  const sniffed = await sniffAsset(input.kind, headBytes);
  if (!sniffed.ok) { await discard(); throw badRequest(sniffed.code); }

  const sibling = await findAsset(ctx, input.sha256);
  if (sibling) { await discard(); return linkExisting(ctx, appId, sibling); }

  const path = finalPath(ctx, input.sha256);
  await storage.remove(path).catch(() => {}); // an unreferenced leftover, e.g. from a deleted app
  await storage.move(staging, path, { contentType: sniffed.mime });
  const [inserted] = await db.insert(schema.assets).values({
    workspaceId: ctx.workspaceId, appId, kind: input.kind, storagePath: path, mime: sniffed.mime,
    width: sniffed.width ?? null, height: sniffed.height ?? null, bytes: size, sha256: input.sha256,
    meta: input.kind === "recording" ? { ready: false } : null,
  }).onConflictDoNothing().returning();
  return inserted ?? (await findAsset(ctx, input.sha256, appId))!;
}

async function signFont(ctx: Ctx, storage: ObjectStorage, input: z.infer<typeof signInput>) {
  if (input.embedRights !== true) throw new HttpError(400, "embed_rights_required", "Confirm you have the right to embed this font");
  if (input.size > UPLOAD_LIMITS.font) throw tooLarge("font");
  const mine = await findWorkspaceFont(ctx, input.sha256);
  if (mine) return { existing: mine };
  await assertFontQuota(db, ctx, input.size);
  const uploadId = randomUUID();
  return { uploadId, ...(await storage.presignPut(stagingPath(ctx, uploadId), { contentType: "application/octet-stream", contentLength: input.size })) };
}

/** Sniffs and parses the whole font in a sandbox; nothing is stored unless it passes. */
async function completeFont(ctx: Ctx, storage: ObjectStorage, input: z.infer<typeof completeInput>): Promise<Asset> {
  const staging = stagingPath(ctx, input.uploadId);
  const discard = () => storage.remove(staging).catch(() => {});
  const mine = await findWorkspaceFont(ctx, input.sha256);
  if (mine) { await discard(); return mine; }

  const { head: bytes, size } = await readStaged(storage, staging, "font", input.sha256); // HEAD_BYTES.font = the whole file
  const type = sniffFontType(bytes);
  if (!type) { await discard(); throw badRequest("unsupported_type"); }
  const parsed = await checkFont(bytes, type.format).catch(async (err) => {
    await discard();
    throw err instanceof FontRejected ? new HttpError(400, err.code, FONT_ERRORS[err.code]) : err;
  });
  const face = { family: fontFamilyFor(parsed.family), weight: parsed.weight, italic: parsed.italic };
  if (await faceTaken(db, ctx.workspaceId, face)) { await discard(); throw faceExists(face); }

  const path = finalPath(ctx, input.sha256);
  await storage.remove(path).catch(() => {});
  await storage.move(staging, path, { contentType: type.mime });
  return withTx(async ({ db: tx }) => {
    // Re-checked under the lock: two uploads of the same file, or of two files with the same face, may have raced past the checks above.
    await lockWorkspace(tx, ctx.workspaceId);
    const [same] = await tx.select().from(schema.assets).where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.kind, "font"), eq(schema.assets.sha256, input.sha256))).limit(1);
    if (same) return same; // its bytes are the ones just moved into place
    const dropBytes = async () => { if (!(await bytesInUse(tx, ctx.workspaceId, input.sha256))) await storage.remove(path).catch(() => {}); };
    if (await faceTaken(tx, ctx.workspaceId, face)) { await dropBytes(); throw faceExists(face); }
    await assertFontQuota(tx, ctx, size).catch(async (err) => { await dropBytes(); throw err; });
    const [inserted] = await tx.insert(schema.assets).values({
      workspaceId: ctx.workspaceId, appId: null, kind: "font", storagePath: path, mime: type.mime, bytes: size, sha256: input.sha256,
      meta: { ...face, format: type.format },
    }).onConflictDoNothing().returning();
    return inserted ?? (await findWorkspaceFont(ctx, input.sha256))!;
  });
}

/**
 * The app's uploads with signed URLs. For a recording, `url` is its poster and `videoUrl` its WebM
 * once converted (both empty while converting). Paths are rebuilt from workspace and hash.
 */
export async function listAssets(ctx: Ctx, storage: ObjectStorage, appId: string): Promise<Array<Asset & { url: string; videoUrl?: string }>> {
  await getApp(ctx, appId);
  const rows = await db.select().from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, appId)))
    .orderBy(desc(schema.assets.createdAt));
  const paths = rows.flatMap((r) => {
    const base = finalPath(ctx, r.sha256);
    if (r.kind !== "recording") return [base];
    return r.meta?.ready ? [`${base}.poster.jpg`, `${base}.webm`] : [];
  });
  const urls = await storage.signedUrls(paths);
  let k = 0;
  return rows.map((r) => {
    if (r.kind !== "recording") return { ...r, url: urls[k++] ?? "" };
    if (!r.meta?.ready) return { ...r, url: "" };
    return { ...r, url: urls[k++] ?? "", videoUrl: urls[k++] ?? "" };
  });
}
