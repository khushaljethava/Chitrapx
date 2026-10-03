import { createHash } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { db, HEAD_BYTES, lockWorkspace, PLANS, PRICES, reserveAndEnqueue, schema, sniffAsset, UPLOAD_LIMITS, withTx, type Tx } from "@chitrapx/db";
import {
  BUNDLE_FORMAT, BUNDLE_VERSION, bundleManifestSchema, CURRENT_SCHEMA_VERSION, docAssetRefs, docBundleRefs, extFor, fromBundleDoc,
  MAX_BUNDLE_BYTES, MAX_BUNDLE_ENTRIES, MAX_DOC_BYTES, migrate, toBundleDoc,
  type BundleManifest, type ChitrapxDoc,
} from "@chitrapx/document";
import { boss } from "./boss.ts";
import { FatalJobError, type JobContext } from "./runJob.ts";

export type BundleDeps = {
  /** An object from the uploads bucket. */
  download(path: string): Promise<Buffer>;
  upload(path: string, bytes: Uint8Array, contentType: string, bucket: "uploads" | "exports"): Promise<void>;
  /** Removes an object from the uploads bucket. */
  remove(path: string): Promise<void>;
};

type BundleAssetKind = BundleManifest["assets"][number]["kind"];
const BUNDLE_KINDS: readonly string[] = ["screenshot", "image", "recording"];

export function packBundle(manifest: BundleManifest, doc: ChitrapxDoc, files: Record<string, Uint8Array>): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "doc.json": strToU8(JSON.stringify(doc)),
    ...files,
  }, { level: 0 }); // images and videos are already compressed
}

// ponytail: the whole file is held in memory (up to MAX_BUNDLE_BYTES); switch to fflate's streaming Zip if worker memory gets tight.
export async function runBundle(_input: unknown, job: JobContext, deps: BundleDeps) {
  if (!job.projectId) throw new FatalJobError("project_missing");
  const [row] = await db.select({ doc: schema.projects.doc, appName: schema.apps.name }).from(schema.projects)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.projects.appId))
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!row) throw new FatalJobError("project_missing");
  const doc = migrate(row.doc);
  const ids = docAssetRefs(doc);
  const assets = ids.length ? await db.select().from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, job.workspaceId), inArray(schema.assets.id, ids))) : [];
  const byId = new Map(assets.map((a) => [a.id, a]));

  let bundled: ChitrapxDoc;
  try { bundled = toBundleDoc(doc, (id) => byId.get(id)?.sha256); }
  catch (err) { throw new FatalJobError((err as Error).message); }

  const unique = [...new Map(assets.map((a) => [a.sha256, a])).values()];
  if (unique.some((a) => !BUNDLE_KINDS.includes(a.kind))) throw new FatalJobError("bundle_invalid");
  if (unique.reduce((n, a) => n + a.bytes, 0) > MAX_BUNDLE_BYTES) throw new FatalJobError("bundle_too_large");

  const files: Record<string, Uint8Array> = {};
  for (const a of unique) files[`assets/${a.sha256}.${extFor(a.mime)}`] = await deps.download(`${job.workspaceId}/${a.sha256}`);
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, docSchema: CURRENT_SCHEMA_VERSION, appName: row.appName,
    exportedAt: new Date().toISOString(),
    assets: unique.map((a) => ({ sha256: a.sha256, kind: a.kind as BundleAssetKind, mime: a.mime })),
  };
  const zip = packBundle(manifest, bundled, files);
  const path = `${job.workspaceId}/${job.id}.chitrapx`;
  await deps.upload(path, zip, "application/zip", "exports");
  return { actual: PRICES.project_bundle, output: { path, bytes: zip.byteLength, assets: unique.length } };
}

const importInput = z.object({ appId: z.uuid(), uploadId: z.uuid(), name: z.string().trim().min(1).max(120) });
const fail = (code: string): never => { throw new FatalJobError(code); };

export type QueueRecording = (tx: Tx, workspaceId: string, assetId: string) => Promise<unknown>;
/** An imported recording still needs its free conversion before it can play. */
const queueRecording: QueueRecording = (tx, workspaceId, assetId) =>
  reserveAndEnqueue(tx, boss, { workspaceId, type: "process_recording", input: { assetId } });

type CheckedAsset = { sha256: string; kind: BundleAssetKind; mime: string; bytes: Uint8Array; width?: number; height?: number };

/** Opens and checks an untrusted .chitrapx file. Every failure is a named FatalJobError. */
async function readBundle(buf: Buffer): Promise<{ doc: ChitrapxDoc; assets: CheckedAsset[] }> {
  if (buf.byteLength > MAX_BUNDLE_BYTES) fail("bundle_too_large");
  // Sizes come from the central directory; nothing is inflated until they pass (zip bombs).
  let entries = 0, total = 0;
  try { unzipSync(new Uint8Array(buf), { filter: (f) => { entries++; total += f.originalSize; return false; } }); }
  catch { fail("bundle_invalid"); }
  if (entries > MAX_BUNDLE_ENTRIES || total > MAX_BUNDLE_BYTES) fail("bundle_too_large");
  const files = unzipSync(new Uint8Array(buf));

  let raw: unknown;
  try { raw = JSON.parse(strFromU8(files["manifest.json"] ?? fail("bundle_invalid"))); } catch (err) { if (err instanceof FatalJobError) throw err; fail("bundle_invalid"); }
  const head = raw as { format?: unknown; version?: unknown } | null;
  if (head?.format === BUNDLE_FORMAT && typeof head.version === "number" && head.version !== BUNDLE_VERSION) fail("bundle_version_unsupported");
  const parsed = bundleManifestSchema.safeParse(raw);
  if (!parsed.success) return fail("bundle_invalid");
  const manifest = parsed.data;

  const docBytes = files["doc.json"] ?? fail("bundle_invalid");
  if (docBytes.byteLength > MAX_DOC_BYTES) fail("bundle_invalid");
  let doc: ChitrapxDoc;
  try { doc = migrate(JSON.parse(strFromU8(docBytes))); } catch { return fail("bundle_invalid"); }

  const listed = new Set(manifest.assets.map((a) => a.sha256));
  if (docBundleRefs(doc).some((s) => !listed.has(s))) fail("bundle_invalid");
  const assets: CheckedAsset[] = [];
  for (const a of manifest.assets) {
    const bytes = files[`assets/${a.sha256}.${extFor(a.mime)}`] ?? fail("bundle_invalid");
    if (bytes.byteLength > UPLOAD_LIMITS[a.kind]) fail("bundle_too_large");
    if (createHash("sha256").update(bytes).digest("hex") !== a.sha256) fail("bundle_asset_mismatch");
    const sniffed = await sniffAsset(a.kind, bytes.subarray(0, HEAD_BYTES[a.kind]));
    if (!sniffed.ok || sniffed.mime !== a.mime) return fail("bundle_asset_mismatch");
    assets.push({ ...a, bytes, width: sniffed.width, height: sniffed.height });
  }
  return { doc, assets };
}

/** A .chitrapx file in this workspace's upload staging becomes a new project in `appId`. */
export async function runImport(raw: unknown, job: JobContext, deps: BundleDeps, queue: QueueRecording = queueRecording) {
  const input = importInput.parse(raw);
  const staging = `${job.workspaceId}/staging/${input.uploadId}`;
  try {
    const buf = await deps.download(staging).catch(() => fail("bundle_invalid"));
    const { doc, assets } = await readBundle(buf);

    // Content-addressed: bytes this workspace already has are not uploaded again. A rolled-back
    // import can leave an unreferenced object; the next upload of the same file replaces it.
    const have = new Set((await db.select({ sha: schema.assets.sha256 }).from(schema.assets)
      .where(and(eq(schema.assets.workspaceId, job.workspaceId), inArray(schema.assets.sha256, ["", ...assets.map((a) => a.sha256)])))).map((r) => r.sha));
    for (const a of assets) if (!have.has(a.sha256)) await deps.upload(`${job.workspaceId}/${a.sha256}`, a.bytes, a.mime, "uploads");

    const projectId = await withTx(async (tx) => {
      await lockWorkspace(tx.db, job.workspaceId);
      const [ws] = await tx.db.select({ plan: schema.workspaces.plan }).from(schema.workspaces).where(eq(schema.workspaces.id, job.workspaceId));
      const [app] = await tx.db.select({ id: schema.apps.id }).from(schema.apps)
        .where(and(eq(schema.apps.id, input.appId), eq(schema.apps.workspaceId, job.workspaceId)));
      if (!ws || !app) fail("project_missing");
      const [{ n }] = (await tx.db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, job.workspaceId))) as [{ n: number }];
      if (n >= PLANS[ws!.plan].maxProjects) fail("plan_limit");

      const idOf = new Map<string, string>();
      for (const a of assets) {
        const [inserted] = await tx.db.insert(schema.assets).values({
          workspaceId: job.workspaceId, appId: input.appId, kind: a.kind, storagePath: `${job.workspaceId}/${a.sha256}`, mime: a.mime,
          width: a.width ?? null, height: a.height ?? null, bytes: a.bytes.byteLength, sha256: a.sha256,
          meta: a.kind === "recording" ? { ready: false } : null,
        }).onConflictDoNothing().returning();
        const row = inserted ?? (await tx.db.select().from(schema.assets).where(and(eq(schema.assets.workspaceId, job.workspaceId),
          eq(schema.assets.appId, input.appId), eq(schema.assets.sha256, a.sha256))))[0]!;
        idOf.set(a.sha256, row.id);
        if (inserted && a.kind === "recording") await queue(tx, job.workspaceId, row.id);
      }
      let finalDoc: ChitrapxDoc;
      try { finalDoc = fromBundleDoc(doc, (s) => idOf.get(s)); } catch { return fail("bundle_invalid"); }
      const [project] = await tx.db.insert(schema.projects).values({
        workspaceId: job.workspaceId, appId: input.appId, name: input.name, kind: finalDoc.kind, doc: { ...finalDoc, brand: { appId: input.appId } },
      }).returning({ id: schema.projects.id });
      return project!.id;
    });
    return { actual: PRICES.project_import, output: { projectId } };
  } finally {
    await deps.remove(staging).catch(() => {});
  }
}
