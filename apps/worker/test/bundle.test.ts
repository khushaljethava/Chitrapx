import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { cleanupFailedImport, packBundle, runBundle, runImport, type BundleDeps } from "../src/bundle.ts";
import { runJob } from "../src/runJob.ts";
import { extractZipEntry, readZipDirectory, ZipError } from "../src/zip.ts";

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

const docWith = (src: string) => ({ schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
  groups: [{ id: "g1", target: "iphone-6.9", spanElements: [], boards: [{ id: "b1", name: "b1", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: [{ id: "d", type: "device", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, screenshotSrc: src }] }] }] });
const manifest = (over: object = {}) => ({ format: "chitrapx-project", version: 1, docSchema: 1, appName: "X", exportedAt: "2026-10-03T12:00:00Z",
  assets: [{ sha256: sha(PNG), kind: "screenshot", mime: "image/png" }], ...over });
const good = () => packBundle(manifest() as never, docWith(`bundle:${sha(PNG)}`) as never, { [`assets/${sha(PNG)}.png`]: PNG });

/** An import job for a fresh workspace (pro plan unless told otherwise) with `bundle` in staging. */
async function importInto(bundle: Uint8Array, plan: "free" | "pro" = "pro", ws?: string, appId?: string, tweak?: (deps: ReturnType<typeof memoryDeps>) => void) {
  ws ??= await makeWorkspace((await createUser()).id);
  await db.update(schema.workspaces).set({ plan }).where(eq(schema.workspaces.id, ws));
  appId ??= (await db.insert(schema.apps).values({ workspaceId: ws, name: "Target" }).returning())[0]!.id;
  const uploadId = crypto.randomUUID();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, type: "project_import", creditsReserved: 0, input: { appId, uploadId, name: "Imported" } }).returning();
  const deps = memoryDeps();
  deps.files.set(`${ws}/staging/${uploadId}`, Buffer.from(bundle));
  tweak?.(deps);
  const thrown = await runJob(job!.id, (input, j) => runImport(input, j, deps, async () => {})).then(() => undefined, (e: unknown) => e);
  return { ws, appId, uploadId, deps, thrown, job: await jobRow(job!.id) };
}

describe("project_import", () => {
  it("creates a project whose sources point at this workspace's assets, and removes the upload", async () => {
    const r = await importInto(good());
    expect(r.job.status).toBe("done");
    const projectId = (r.job.output as { projectId: string }).projectId;
    const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    expect(p).toMatchObject({ workspaceId: r.ws, appId: r.appId, name: "Imported" });
    const src = (p!.doc as ReturnType<typeof docWith>).groups[0]!.boards[0]!.elements[0]!.screenshotSrc;
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, src.replace("asset:", "")));
    expect(asset).toMatchObject({ workspaceId: r.ws, appId: r.appId, sha256: sha(PNG), mime: "image/png", width: 2, height: 3 });
    expect(r.deps.files.has(`${r.ws}/staging/${r.uploadId}`)).toBe(false);
    expect(r.deps.files.get(`uploads:${r.ws}/${sha(PNG)}`)).toEqual(PNG);
  });

  async function fails(bundle: Uint8Array, code: string) {
    const r = await importInto(bundle);
    expect(r.job.status).toBe("failed");
    expect(r.job.error).toBe(code);
    expect(await db.select().from(schema.projects).where(eq(schema.projects.workspaceId, r.ws))).toEqual([]);
    expect(r.deps.files.has(`${r.ws}/staging/${r.uploadId}`)).toBe(false);
  }

  it("rejects more than 500 entries before extracting", () =>
    fails(zipSync(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`f${i}`, new Uint8Array(1)]))), "bundle_too_large"));
  it("rejects a newer format version", () =>
    fails(packBundle(manifest({ version: 2 }) as never, docWith("x") as never, {}), "bundle_version_unsupported"));
  it("rejects an asset whose bytes do not match its name", () =>
    fails(packBundle(manifest() as never, docWith(`bundle:${sha(PNG)}`) as never, { [`assets/${sha(PNG)}.png`]: Buffer.from("not the png") }), "bundle_asset_mismatch"));
  it("rejects a reference with no file", () =>
    fails(packBundle(manifest({ assets: [] }) as never, docWith(`bundle:${"b".repeat(64)}`) as never, {}), "bundle_invalid"));
  it("rejects an oversized document", () =>
    fails(zipSync({ "manifest.json": strToU8(JSON.stringify(manifest({ assets: [] }))), "doc.json": new Uint8Array(5 * 1024 * 1024 + 1) }), "bundle_invalid"));
  it("rejects a file that is not a zip", () => fails(strToU8("hello"), "bundle_invalid"));

  it("stops at the plan's project limit, checked under the workspace lock", async () => {
    const ws = await makeWorkspace((await createUser()).id);
    const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Full" }).returning();
    for (let i = 0; i < 3; i++) await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: `p${i}`, kind: "screenshots", doc: docWith("x") });
    const r = await importInto(good(), "free", ws, app!.id);
    expect(r.job).toMatchObject({ status: "failed", error: "plan_limit" });
    expect(await db.select().from(schema.projects).where(eq(schema.projects.workspaceId, ws))).toHaveLength(3);
  });

  it("rejects a document that names another workspace's asset directly", () =>
    fails(packBundle(manifest({ assets: [] }) as never, docWith(`asset:${crypto.randomUUID()}`) as never, {}), "bundle_invalid"));

  it("rejects an entry whose header lies about its size, without inflating it", async () => {
    const zip = Buffer.from(zipSync({ "manifest.json": new Uint8Array(30 * 1024 * 1024) }, { level: 9 }));
    zip.writeUInt32LE(1, zip.lastIndexOf(Buffer.from([0x50, 0x4b, 1, 2])) + 24);
    const t = Date.now();
    await fails(zip, "bundle_invalid");
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("rejects a huge declared entry count before walking it", async () => {
    const zip = Buffer.from(good());
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
    zip.writeUInt16LE(0xffff, eocd + 8); zip.writeUInt16LE(0xffff, eocd + 10);
    const t = Date.now();
    await fails(zip, "bundle_too_large");
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("keeps the staged upload when a transient error will be retried, and imports on the retry", async () => {
    let failed = false;
    const r = await importInto(good(), "pro", undefined, undefined, (deps) => {
      const up = deps.upload;
      deps.upload = async (...a) => { if (!failed) { failed = true; throw new Error("storage blip"); } return up(...a); };
    });
    expect(r.thrown).toBeInstanceOf(Error);
    expect(r.job.status).toBe("queued");
    expect(r.deps.files.has(`${r.ws}/staging/${r.uploadId}`)).toBe(true);
    await runJob(r.job.id, (input, j) => runImport(input, j, r.deps, async () => {}));
    expect((await jobRow(r.job.id)).status).toBe("done");
    expect(r.deps.files.has(`${r.ws}/staging/${r.uploadId}`)).toBe(false);
  });

  it("removes the staged upload when the import fails for good", async () => {
    const deps = memoryDeps();
    const ws = await makeWorkspace((await createUser()).id);
    const uploadId = crypto.randomUUID();
    const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, type: "project_import", creditsReserved: 0, input: { appId: crypto.randomUUID(), uploadId, name: "n" } }).returning();
    deps.files.set(`${ws}/staging/${uploadId}`, Buffer.from("x"));
    await cleanupFailedImport(db, { id: job!.id, workspaceId: ws, projectId: null }, deps);
    expect(deps.files.has(`${ws}/staging/${uploadId}`)).toBe(false);
  });
});

describe("zip reader", () => {
  const limits = { entries: 500, totalBytes: 1000 };
  it("reads stored and deflated entries", () => {
    const zip = Buffer.from(zipSync({ a: [new Uint8Array(100).fill(7), { level: 0 }], b: [new Uint8Array(100).fill(7), { level: 6 }] }));
    const dir = readZipDirectory(zip, limits);
    expect(extractZipEntry(zip, dir.get("a")!)).toEqual(Buffer.alloc(100, 7));
    expect(extractZipEntry(zip, dir.get("b")!)).toEqual(Buffer.alloc(100, 7));
  });
  it("refuses sizes over the total limit and non-zips", () => {
    expect(() => readZipDirectory(Buffer.from(zipSync({ a: new Uint8Array(2000) })), limits)).toThrow(ZipError);
    expect(() => readZipDirectory(Buffer.from("hello world, not a zip file at all"), limits)).toThrow(ZipError);
  });
  it("refuses a deflated entry that expands past its declared size", () => {
    const zip = Buffer.from(zipSync({ a: new Uint8Array(500) }));
    zip.writeUInt32LE(10, zip.lastIndexOf(Buffer.from([0x50, 0x4b, 1, 2])) + 24);
    expect(() => extractZipEntry(zip, readZipDirectory(zip, limits).get("a")!)).toThrow(ZipError);
  });
  it("refuses a stored entry whose sizes disagree", () => {
    const zip = Buffer.from(zipSync({ a: [new Uint8Array(50), { level: 0 }] }));
    zip.writeUInt32LE(5, zip.lastIndexOf(Buffer.from([0x50, 0x4b, 1, 2])) + 24);
    expect(() => extractZipEntry(zip, readZipDirectory(zip, limits).get("a")!)).toThrow(ZipError);
  });
});
