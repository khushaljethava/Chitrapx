import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { balance, db, schema, type JobType } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import type { BundleDeps } from "../src/bundle.ts";
import { runAppIcons } from "../src/icons/index.ts";
import { runJob, type JobHandler } from "../src/runJob.ts";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Uploads keyed by path; uploads are stored as "<bucket>:<path>". */
function memoryDeps(): BundleDeps & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async download(path) { const f = files.get(path); if (!f) throw new Error(`missing ${path}`); return f; },
    async upload(path, bytes, _type, bucket) { files.set(`${bucket ?? "uploads"}:${path}`, Buffer.from(bytes)); },
    async remove(path) { files.delete(path); },
  };
}

/** A workspace with 5 credits and a queued job that reserved `cost`, as reserveAndEnqueue leaves it. */
async function queued(type: JobType, cost: number, input: unknown) {
  const ws = await makeWorkspace((await createUser()).id);
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 5, reason: "adjust" });
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, type, creditsReserved: cost, input }).returning();
  if (cost) await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -cost, reason: "reserve", jobId: job!.id });
  return { ws, jobId: job!.id };
}
const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;
const run = (jobId: string, handler: JobHandler) => runJob(jobId, handler);

describe("app_icons job", () => {
  it("stores the icon ZIP in exports and settles one credit", async () => {
    const png = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#33aa66" } }).png().toBuffer();
    const hash = sha(png);
    const { ws, jobId } = await queued("app_icons", 1, { assetId: crypto.randomUUID(), sha256: hash, platforms: ["iphone", "android"], androidName: "ic_launcher", includeStores: true });
    const deps = memoryDeps();
    deps.files.set(`${ws}/${hash}`, png);
    await run(jobId, (input, job) => runAppIcons(input, job, deps));
    const job = await jobRow(jobId);
    expect(job).toMatchObject({ status: "done", output: { path: `${ws}/${jobId}.zip`, warnings: ["source_small"] } });
    const zip = unzipSync(new Uint8Array(deps.files.get(`exports:${ws}/${jobId}.zip`)!));
    expect(Object.keys(zip)).toContain("Assets.xcassets/AppIcon.appiconset/Contents.json");
    expect(Object.keys(zip)).toContain("android/mipmap-xxxhdpi/ic_launcher_foreground.png");
    expect(await balance(db, ws)).toBe(4);
  });

  it("a corrupt source fails at once, without retry, and refunds", async () => {
    const bad = Buffer.from("definitely not a png");
    const { ws, jobId } = await queued("app_icons", 1, { assetId: crypto.randomUUID(), sha256: sha(bad), platforms: ["iphone"], androidName: "ic_launcher", includeStores: false });
    const deps = memoryDeps();
    deps.files.set(`${ws}/${sha(bad)}`, bad);
    await run(jobId, (input, job) => runAppIcons(input, job, deps));
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "icon_unreadable", attempts: 1 });
    expect(await balance(db, ws)).toBe(5);
  });
});
