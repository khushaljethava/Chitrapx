import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { runBundle, type BundleDeps } from "../src/bundle.ts";
import { runJob } from "../src/runJob.ts";

let PNG: Buffer;
beforeAll(async () => { PNG = await sharp({ create: { width: 2, height: 3, channels: 3, background: "#123456" } }).png().toBuffer(); });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Uploads-bucket objects keyed by path; uploads are stored as "<bucket>:<path>". */
function memoryDeps(): BundleDeps & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async download(path) { const f = files.get(path); if (!f) throw new Error(`missing ${path}`); return f; },
    async upload(path, bytes, _type, bucket) { files.set(`${bucket}:${path}`, Buffer.from(bytes)); },
    async remove(path) { files.delete(path); },
  };
}
const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

async function projectWithAsset() {
  const ws = await makeWorkspace((await createUser()).id);
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Bundle app" }).returning();
  const hash = sha(PNG);
  const [asset] = await db.insert(schema.assets).values({ workspaceId: ws, appId: app!.id, kind: "screenshot", storagePath: `${ws}/${hash}`, mime: "image/png", bytes: PNG.length, sha256: hash, width: 2, height: 3 }).returning();
  const b = { id: "b1", name: "b1", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: [{ id: "d", type: "device", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, screenshotSrc: `asset:${asset!.id}` }] };
  const doc = { schemaVersion: 1, kind: "screenshots", groups: [{ id: "g1", target: "iphone-6.9", boards: [b], spanElements: [] }], localization: { baseLocale: "en-US", locales: [] } };
  const [project] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: "P", kind: "screenshots", doc }).returning();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: project!.id, type: "project_bundle", creditsReserved: 0 }).returning();
  const deps = memoryDeps();
  deps.files.set(`${ws}/${hash}`, PNG);
  return { ws, hash, assetId: asset!.id, jobId: job!.id, deps };
}

describe("project_bundle", () => {
  it("packs the manifest, the rewritten doc and the asset originals", async () => {
    const p = await projectWithAsset();
    await runJob(p.jobId, (input, job) => runBundle(input, job, p.deps));
    expect((await jobRow(p.jobId)).status).toBe("done");
    const zip = unzipSync(new Uint8Array(p.deps.files.get(`exports:${p.ws}/${p.jobId}.chitrapx`)!));
    expect(JSON.parse(strFromU8(zip["manifest.json"]!))).toMatchObject({
      format: "chitrapx-project", version: 1, docSchema: 1, appName: "Bundle app", assets: [{ sha256: p.hash, kind: "screenshot", mime: "image/png" }],
    });
    expect(strFromU8(zip["doc.json"]!)).toContain(`bundle:${p.hash}`);
    expect(Buffer.from(zip[`assets/${p.hash}.png`]!)).toEqual(PNG);
  });

  it("fails with asset_missing when the document references a deleted asset", async () => {
    const p = await projectWithAsset();
    await db.delete(schema.assets).where(eq(schema.assets.id, p.assetId));
    await runJob(p.jobId, (input, job) => runBundle(input, job, p.deps));
    const job = await jobRow(p.jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/^asset_missing/);
  });
});
