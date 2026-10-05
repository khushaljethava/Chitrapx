import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { PgBoss } from "pg-boss";
import { db, reserveAndEnqueue, schema, withTx } from "@chitrapx/db";
import { appIconsRequest, COLLAGE_SOURCE_MAX_EDGE, collageRequest, LAUNCH_SOURCE_MAX_BYTES, LOGO_SEED_MAX, logoRequest, MIN_ICON_SOURCE, mockupDoc, mockupRequest, needsFitChoice } from "@chitrapx/document";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { HttpError, notFound } from "./http.ts";
import { assertFreeQuota } from "./jobs.ts";

type Asset = typeof schema.assets.$inferSelect;

/** A screenshot or image upload of this workspace, at most 10 MB. Recordings, fonts and competitor images are refused. */
export async function launchImage(ctx: Ctx, assetId: string): Promise<Asset & { width: number; height: number }> {
  if (!z.uuid().safeParse(assetId).success) throw notFound();
  const [a] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, assetId), eq(schema.assets.workspaceId, ctx.workspaceId)));
  if (!a) throw notFound();
  if (a.kind !== "screenshot" && a.kind !== "image") throw new HttpError(400, "not_an_image", "Pick an image (PNG, JPEG or WebP), not a recording");
  if (a.bytes > LAUNCH_SOURCE_MAX_BYTES) throw new HttpError(413, "too_large", "Images can be up to 10 MB here");
  if (!a.width || !a.height) throw new HttpError(400, "not_an_image", "This image's size could not be read");
  return { ...a, width: a.width, height: a.height };
}

/** app_icons (1 credit): every store icon file from one square image. Checked here so nothing is reserved for a bad source. */
export async function enqueueAppIcons(ctx: Ctx, boss: PgBoss, raw: unknown): Promise<{ jobId: string }> {
  const body = appIconsRequest.parse(raw ?? {});
  const a = await launchImage(ctx, body.assetId);
  if (a.width !== a.height) throw new HttpError(400, "icon_not_square", `The icon image must be square; this one is ${a.width}×${a.height}`);
  if (a.width < MIN_ICON_SOURCE) throw new HttpError(400, "icon_too_small", `The icon image must be at least ${MIN_ICON_SOURCE}×${MIN_ICON_SOURCE}`);
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "app_icons", input: { ...body, sha256: a.sha256 } }));
}

const fitRequired = () => new HttpError(400, "fit_required", "This screenshot's shape differs from the device's screen. Choose fit or fill.");

/**
 * mockup (free, hourly allowance): one screenshot inside a device frame. The one-board document is
 * built here and travels in the job input, so no helper project is created or left behind.
 */
export async function enqueueMockup(ctx: Ctx, boss: PgBoss, raw: unknown): Promise<{ jobId: string }> {
  const body = mockupRequest.parse(raw ?? {});
  const a = await launchImage(ctx, body.assetId);
  if (!body.fit && needsFitChoice(body.deviceType, a.width, a.height)) throw fitRequired();
  const built = mockupDoc([{ src: `asset:${a.id}`, fit: body.fit }], { deviceType: body.deviceType, background: body.background });
  return withTx(async (tx) => {
    await assertFreeQuota(tx, ctx.workspaceId);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "mockup", input: { ...body, ...built } });
  });
}

/**
 * collage (1 credit): 2 to 12 images in a grid, in the order given. Every source is checked here,
 * before anything is reserved. With a frame, the mockup document of all of them rides along.
 */
export async function enqueueCollage(ctx: Ctx, boss: PgBoss, raw: unknown): Promise<{ jobId: string }> {
  const body = collageRequest.parse(raw ?? {});
  const sources = [];
  for (const id of body.assetIds) {
    const a = await launchImage(ctx, id);
    if (Math.max(a.width, a.height) > COLLAGE_SOURCE_MAX_EDGE) throw new HttpError(400, "image_too_large", `Images can be up to ${COLLAGE_SOURCE_MAX_EDGE} px on the long side`);
    sources.push(a);
  }
  const images = sources.map((a) => ({ assetId: a.id, sha256: a.sha256 }));
  let framed = {};
  if (body.frame) {
    const { deviceType, fit } = body.frame;
    if (!fit && sources.some((a) => needsFitChoice(deviceType, a.width, a.height))) throw fitRequired();
    framed = mockupDoc(sources.map((a) => ({ src: `asset:${a.id}`, fit })), { deviceType, margin: 0 });
  }
  return withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "collage", input: { ...body, images, ...framed } }));
}

/** logo_starter (free, hourly allowance): a seeded 1024 logo stored as an image of the app. Returns the seed used. */
export async function enqueueLogo(ctx: Ctx, boss: PgBoss, raw: unknown): Promise<{ jobId: string; seed: number }> {
  const body = logoRequest.parse(raw ?? {});
  await getApp(ctx, body.appId);
  const seed = body.seed ?? randomInt(0, LOGO_SEED_MAX + 1);
  const { jobId } = await withTx(async (tx) => {
    await assertFreeQuota(tx, ctx.workspaceId);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "logo_starter", input: { appId: body.appId, text: body.text ?? "", seed } });
  });
  return { jobId, seed };
}
