import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { EXPORTS_BUCKET } from "@chitrapx/storage";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema, type JobType } from "@chitrapx/db";
import { mockupDoc, type Crop } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { bundleDeps } from "../src/handlers.ts";
import { runMockup } from "../src/mockup.ts";
import { runJob } from "../src/runJob.ts";
import { storage } from "../src/storage.ts";

const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const RED = { r: 230, g: 20, b: 20 };

beforeAll(async () => {
  const res = await fetch(`${ORIGIN}/api/health`).catch(() => null);
  if (!res?.ok) throw new Error(`web app not reachable at ${ORIGIN}; start it with pnpm dev`);
});

/** A workspace with an app and one solid red screenshot in uploads. */
async function workspaceWithShot(width = 1170, height = 2532) {
  const ws = await makeWorkspace((await createUser()).id);
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Launch e2e" }).returning();
  const png = await sharp({ create: { width, height, channels: 3, background: RED } }).png().toBuffer();
  const sha256 = createHash("sha256").update(png).digest("hex");
  await storage().put(`${ws}/${sha256}`, png, "image/png");
  const [asset] = await db.insert(schema.assets).values({ workspaceId: ws, appId: app!.id, kind: "screenshot", storagePath: `${ws}/${sha256}`, mime: "image/png", width, height, bytes: png.length, sha256 }).returning();
  return { ws, appId: app!.id, assetId: asset!.id, sha256 };
}

async function queuedJob(ws: string, type: JobType, input: unknown) {
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, type, creditsReserved: 0, input }).returning();
  return job!.id;
}
const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
}

describe("quick mockup", () => {
  it("renders the screenshot inside the device on a transparent background", async () => {
    const { ws, assetId } = await workspaceWithShot();
    const built = mockupDoc([{ src: `asset:${assetId}` }], { deviceType: "iphone-15" });
    const jobId = await queuedJob(ws, "mockup", { assetId, deviceType: "iphone-15", ...built });
    await runJob(jobId, (input, job) => runMockup(input, job, bundleDeps));
    const crop: Crop = built.crops[0]!;
    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { width: crop.width, height: crop.height } });
    const png = await storage().download(`${ws}/${jobId}.png`, EXPORTS_BUCKET);
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(["png", crop.width, crop.height, true]);
    expect((await pixel(png, 2, 2)).a).toBe(0);
    expect((await pixel(png, crop.width - 3, crop.height - 3)).a).toBe(0);
    const centre = await pixel(png, Math.round(crop.width / 2), Math.round(crop.height / 2));
    expect(centre).toMatchObject({ a: 255 });
    expect(Math.abs(centre.r - RED.r) + Math.abs(centre.g - RED.g) + Math.abs(centre.b - RED.b)).toBeLessThan(30);
  });

  it("fills the background when a colour is chosen", async () => {
    const { ws, assetId } = await workspaceWithShot(1000, 1000);
    const built = mockupDoc([{ src: `asset:${assetId}`, fit: "fit" }], { deviceType: "ipad-11", background: "#00ff00" });
    const jobId = await queuedJob(ws, "mockup", { assetId, deviceType: "ipad-11", fit: "fit", background: "#00ff00", ...built });
    await runJob(jobId, (input, job) => runMockup(input, job, bundleDeps));
    expect((await jobRow(jobId)).status).toBe("done");
    const png = await storage().download(`${ws}/${jobId}.png`, EXPORTS_BUCKET);
    expect(await pixel(png, 2, 2)).toMatchObject({ r: 0, g: 255, b: 0, a: 255 });
  });
});
