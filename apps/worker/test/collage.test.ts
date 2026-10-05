import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { balance, db, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { runCollage } from "../src/collage.ts";
import { collageLayout, defaultPadding, fitInside, gridSize, layoutGrid, MAX_COLLAGE_EDGE } from "../src/collageLayout.ts";
import { runJob } from "../src/runJob.ts";

describe("collage layout (launch's grid rules)", () => {
  it("uses ceil(sqrt(n)) columns", () => {
    expect(gridSize(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridSize(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridSize(5)).toEqual({ cols: 3, rows: 2 });
    expect(gridSize(9)).toEqual({ cols: 3, rows: 3 });
    expect(gridSize(12)).toEqual({ cols: 4, rows: 3 });
  });

  it("canvas is cols*cellW + (cols+1)*p by rows*cellH + (rows+1)*p, filled left to right", () => {
    const l = layoutGrid(5, 100, 200, 10);
    expect([l.width, l.height]).toEqual([3 * 100 + 4 * 10, 2 * 200 + 3 * 10]);
    expect(l.cells).toEqual([{ x: 10, y: 10 }, { x: 120, y: 10 }, { x: 230, y: 10 }, { x: 10, y: 220 }, { x: 120, y: 220 }]);
  });

  it("default padding is 3% of the cell width, scaled up for bigger grids", () => {
    expect(defaultPadding(1000, 2, 2)).toBe(Math.floor(30 * 1.4));
    expect(defaultPadding(1000, 3, 3)).toBe(Math.floor(30 * 1.8));
  });

  it("fits an image inside its cell without stretching, centred", () => {
    const f = fitInside(500, 1000, 400, 400);
    expect(f).toEqual({ width: 200, height: 400, left: 100, top: 0 });
  });

  it("scales cells and padding down together past 8192 px", () => {
    const l = collageLayout(9, 1320, 2868, 100);
    expect(Math.max(l.width, l.height)).toBeLessThanOrEqual(MAX_COLLAGE_EDGE);
    expect(l.cellW / l.cellH).toBeCloseTo(1320 / 2868, 2);
    const small = collageLayout(4, 100, 100, 5);
    expect([small.width, small.cellW, small.padding]).toEqual([215, 100, 5]);
  });
});

const solid = (w: number, h: number, c: string) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function rgbaAt(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

async function collageJob(images: Buffer[], extra: Record<string, unknown> = {}) {
  const ws = await makeWorkspace((await createUser()).id);
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 3, reason: "adjust" });
  const files = new Map<string, Buffer>();
  const list = images.map((b) => { files.set(`${ws}/${sha(b)}`, b); return { assetId: crypto.randomUUID(), sha256: sha(b) }; });
  const input = { assetIds: list.map((i) => i.assetId), images: list, background: { from: "#000000" }, ...extra };
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, type: "collage", creditsReserved: 1, input }).returning();
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -1, reason: "reserve", jobId: job!.id });
  const deps = {
    async download(path: string) { const f = files.get(path); if (!f) throw new Error(`missing ${path}`); return f; },
    async upload(path: string, bytes: Uint8Array, _t: string, bucket: string) { files.set(`${bucket}:${path}`, Buffer.from(bytes)); },
  };
  return { ws, jobId: job!.id, files, deps };
}
const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

describe("collage job", () => {
  it("lays mixed sizes into an opaque grid without stretching and settles one credit", async () => {
    const { ws, jobId, files, deps } = await collageJob([await solid(100, 200, "#ff0000"), await solid(200, 200, "#00ff00"), await solid(100, 200, "#0000ff")], { padding: 10 });
    await runJob(jobId, (input, job) => runCollage(input, job, deps));
    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { cols: 2, rows: 2, width: 2 * 100 + 3 * 10, height: 2 * 200 + 3 * 10 } });
    const png = files.get(`exports:${ws}/${jobId}.png`)!;
    expect((await sharp(png).metadata()).channels).toBe(3);
    expect(await rgbaAt(png, 60, 110)).toEqual([255, 0, 0, 255]);
    // The square green image is fitted into the 100x200 cell as 100x100, centred: black above and below it.
    expect(await rgbaAt(png, 170, 40)).toEqual([0, 0, 0, 255]);
    expect(await rgbaAt(png, 170, 110)).toEqual([0, 255, 0, 255]);
    expect(await rgbaAt(png, 60, 320)).toEqual([0, 0, 255, 255]);
    expect(await rgbaAt(png, 170, 320)).toEqual([0, 0, 0, 255]); // the empty fourth cell
    expect(await balance(db, ws)).toBe(2);
  });

  it("with a frame, places the rendered devices instead of the raw screenshots", async () => {
    const { ws, jobId, files, deps } = await collageJob([await solid(10, 10, "#ffffff"), await solid(10, 10, "#ffffff")], {
      frame: { deviceType: "iphone-15" }, doc: {}, selection: {}, crops: [{ left: 0, top: 0, width: 50, height: 100 }, { left: 0, top: 0, width: 50, height: 100 }], padding: 0,
    });
    const framed = await sharp({ create: { width: 50, height: 100, channels: 4, background: { r: 255, g: 255, b: 0, alpha: 1 } } }).png().toBuffer();
    await runJob(jobId, (input, job) => runCollage(input, job, deps, async () => [framed, framed]));
    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { width: 100, height: 100 } });
    expect(await rgbaAt(files.get(`exports:${ws}/${jobId}.png`)!, 75, 50)).toEqual([255, 255, 0, 255]);
  });

  it("a gradient background runs from the first colour at the top to the second at the bottom", async () => {
    const { ws, jobId, files, deps } = await collageJob([await solid(100, 100, "#808080"), await solid(100, 100, "#808080")], { padding: 50, background: { from: "#ff0000", to: "#0000ff" } });
    await runJob(jobId, (input, job) => runCollage(input, job, deps));
    const png = files.get(`exports:${ws}/${jobId}.png`)!;
    const top = await rgbaAt(png, 5, 0), bottom = await rgbaAt(png, 5, 199);
    expect(top[0]!).toBeGreaterThan(200);
    expect(bottom[2]!).toBeGreaterThan(200);
  });

  it("an unreadable source fails without retry and refunds", async () => {
    const { ws, jobId, deps } = await collageJob([Buffer.from("nope"), await solid(10, 10, "#000")]);
    await runJob(jobId, (input, job) => runCollage(input, job, deps));
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "collage_unreadable", attempts: 1 });
    expect(await balance(db, ws)).toBe(3);
  });
});
