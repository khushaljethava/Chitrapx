import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { z } from "zod";
import { db, schema } from "@chitrapx/db";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { badRequest, HttpError } from "./http.ts";
import type { ObjectStorage } from "./storage.ts";

const MB = 1024 * 1024;
export const UPLOAD_LIMITS = { screenshot: 25 * MB, image: 25 * MB, recording: 500 * MB, font: 10 * MB } as const;
// ponytail: SVG stays out until it is sanitized; recordings and fonts arrive with their sub-projects.
const ACCEPTED: Record<UploadKind, readonly string[]> = {
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  image: ["image/png", "image/jpeg", "image/webp"],
};

const uploadKind = z.enum(["screenshot", "image"]);
type UploadKind = z.infer<typeof uploadKind>;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const signInput = z.object({ appId: z.uuid(), kind: uploadKind, size: z.number().int().positive(), mime: z.string(), sha256 });
const completeInput = z.object({ appId: z.uuid(), kind: uploadKind, sha256 });

export type Asset = typeof schema.assets.$inferSelect;

const tooLarge = (kind: UploadKind) => new HttpError(413, "too_large", `Files of this type can be up to ${UPLOAD_LIMITS[kind] / MB} MB`);
// Bytes are shared per workspace; rows are per app.
const pathFor = (ctx: Ctx, hash: string) => `${ctx.workspaceId}/${hash}`;

async function findAsset(ctx: Ctx, appId: string, hash: string) {
  const [asset] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, appId), eq(schema.assets.sha256, hash),
  ));
  return asset;
}

export async function signUpload(ctx: Ctx, storage: ObjectStorage, raw: unknown): Promise<{ existing: Asset } | { path: string; token: string }> {
  const input = signInput.parse(raw);
  await getApp(ctx, input.appId);
  if (input.size > UPLOAD_LIMITS[input.kind]) throw tooLarge(input.kind);
  if (!ACCEPTED[input.kind].includes(input.mime)) throw badRequest("unsupported_type");
  const existing = await findAsset(ctx, input.appId, input.sha256);
  if (existing) return { existing };
  return storage.signUpload(pathFor(ctx, input.sha256));
}

/** Verifies the uploaded bytes themselves; the client's size, type and checksum are never trusted. */
export async function completeUpload(ctx: Ctx, storage: ObjectStorage, raw: unknown): Promise<Asset> {
  const input = completeInput.parse(raw);
  await getApp(ctx, input.appId);
  const path = pathFor(ctx, input.sha256);
  const already = await findAsset(ctx, input.appId, input.sha256);
  if (already) return already;

  const bytes = await storage.download(path).catch(() => { throw badRequest("upload_missing"); });
  const reject = async (err: HttpError): Promise<never> => {
    const [inUse] = await db.select({ id: schema.assets.id }).from(schema.assets)
      .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.storagePath, path))).limit(1);
    if (!inUse) await storage.remove(path);
    throw err;
  };

  if (bytes.length > UPLOAD_LIMITS[input.kind]) return reject(tooLarge(input.kind));
  if (createHash("sha256").update(bytes).digest("hex") !== input.sha256) return reject(badRequest("checksum_mismatch"));
  const type = await fileTypeFromBuffer(bytes);
  if (!type || !ACCEPTED[input.kind].includes(type.mime)) return reject(badRequest("unsupported_type"));
  let dims: { width?: number; height?: number } = {};
  try { dims = imageSize(bytes); } catch { return reject(badRequest("unreadable_image")); }

  const [inserted] = await db.insert(schema.assets).values({
    workspaceId: ctx.workspaceId, appId: input.appId, kind: input.kind, storagePath: path, mime: type.mime,
    width: dims.width ?? null, height: dims.height ?? null, bytes: bytes.length, sha256: input.sha256,
  }).onConflictDoNothing().returning();
  return inserted ?? (await findAsset(ctx, input.appId, input.sha256))!;
}

export async function listAssets(ctx: Ctx, storage: ObjectStorage, appId: string): Promise<Array<Asset & { url: string }>> {
  await getApp(ctx, appId);
  const rows = await db.select().from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, appId)))
    .orderBy(desc(schema.assets.createdAt));
  const urls = await storage.signedUrls(rows.map((r) => r.storagePath));
  return rows.map((r, i) => ({ ...r, url: urls[i] ?? "" }));
}
