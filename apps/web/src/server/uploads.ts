import { createHash, randomUUID } from "node:crypto";
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
  recording: ["video/mp4", "video/quicktime", "video/x-m4v"],
};
/** Bytes kept for type sniffing and image dimensions (JPEG headers can sit after a large EXIF block). */
const HEAD_BYTES = { screenshot: 512 * 1024, image: 512 * 1024, recording: 64 * 1024 } as const;

const uploadKind = z.enum(["screenshot", "image", "recording"]);
type UploadKind = z.infer<typeof uploadKind>;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const signInput = z.object({ appId: z.uuid(), kind: uploadKind, size: z.number().int().positive(), mime: z.string(), sha256 });
const completeInput = z.object({ appId: z.uuid(), kind: uploadKind, sha256, uploadId: z.uuid() });

export type Asset = typeof schema.assets.$inferSelect;

const tooLarge = (kind: UploadKind) => new HttpError(413, "too_large", `Files of this type can be up to ${UPLOAD_LIMITS[kind] / MB} MB`);
/** Validated bytes live once per workspace here; asset rows are per app. Always derived, never read from a row. */
const finalPath = (ctx: Ctx, hash: string) => `${ctx.workspaceId}/${hash}`;
/** Clients only ever get a token for a fresh staging path, so they can never touch validated bytes. */
const stagingPath = (ctx: Ctx, uploadId: string) => `${ctx.workspaceId}/staging/${uploadId}`;

async function findAsset(ctx: Ctx, hash: string, appId?: string) {
  const [asset] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.sha256, hash),
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
  Promise<{ existing: Asset } | { uploadId: string; path: string; token: string }> {
  const input = signInput.parse(raw);
  await getApp(ctx, input.appId);
  if (input.size > UPLOAD_LIMITS[input.kind]) throw tooLarge(input.kind);
  if (!ACCEPTED[input.kind].includes(input.mime)) throw badRequest("unsupported_type");

  const mine = await findAsset(ctx, input.sha256, input.appId);
  if (mine) return { existing: mine };
  const sibling = await findAsset(ctx, input.sha256);
  if (sibling) return { existing: await linkExisting(ctx, input.appId, sibling) };

  const uploadId = randomUUID();
  // ponytail: abandoned staging objects are never cleaned up; add a sweep of */staging/* older than a day.
  return { uploadId, ...(await storage.signUpload(stagingPath(ctx, uploadId))) };
}

/** Validates the uploaded bytes themselves (the client's size, type and checksum are never trusted), then publishes them. */
export async function completeUpload(ctx: Ctx, storage: ObjectStorage, raw: unknown): Promise<Asset> {
  const input = completeInput.parse(raw);
  await getApp(ctx, input.appId);
  const staging = stagingPath(ctx, input.uploadId);
  const discard = () => storage.remove(staging).catch(() => {});

  const mine = await findAsset(ctx, input.sha256, input.appId);
  if (mine) { await discard(); return mine; }

  const reject = async (err: HttpError): Promise<never> => { await discard(); throw err; };
  // Streamed: hash and size are computed as bytes arrive, and only the head is kept.
  const stream = await storage.downloadStream(staging).catch(() => { throw badRequest("upload_missing"); });
  const reader = stream.getReader();
  const hash = createHash("sha256");
  const head: Uint8Array[] = [];
  let size = 0, headSize = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > UPLOAD_LIMITS[input.kind]) { await reader.cancel(); return reject(tooLarge(input.kind)); }
    hash.update(value);
    if (headSize < HEAD_BYTES[input.kind]) { head.push(value); headSize += value.byteLength; }
  }
  const headBytes = Buffer.concat(head);
  if (hash.digest("hex") !== input.sha256) return reject(badRequest("checksum_mismatch"));
  const type = await fileTypeFromBuffer(headBytes);
  if (!type || !ACCEPTED[input.kind].includes(type.mime)) return reject(badRequest("unsupported_type"));
  let dims: { width?: number; height?: number } = {};
  if (input.kind !== "recording") {
    try { dims = imageSize(headBytes); } catch { return reject(badRequest("unreadable_image")); }
  }

  const sibling = await findAsset(ctx, input.sha256);
  if (sibling) { await discard(); return linkExisting(ctx, input.appId, sibling); }

  const path = finalPath(ctx, input.sha256);
  await storage.remove(path).catch(() => {}); // an unreferenced leftover, e.g. from a deleted app
  await storage.move(staging, path);
  const [inserted] = await db.insert(schema.assets).values({
    workspaceId: ctx.workspaceId, appId: input.appId, kind: input.kind, storagePath: path, mime: type.mime,
    width: dims.width ?? null, height: dims.height ?? null, bytes: size, sha256: input.sha256,
    // Recordings become playable once the worker has converted them.
    meta: input.kind === "recording" ? { ready: false } : null,
  }).onConflictDoNothing().returning();
  return inserted ?? (await findAsset(ctx, input.sha256, input.appId))!;
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
