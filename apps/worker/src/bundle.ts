import { and, eq, inArray } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { db, PRICES, schema } from "@chitrapx/db";
import {
  BUNDLE_FORMAT, BUNDLE_VERSION, CURRENT_SCHEMA_VERSION, docAssetRefs, extFor, MAX_BUNDLE_BYTES, migrate, toBundleDoc,
  type BundleManifest, type ChitrapxDoc,
} from "@chitrapx/document";
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
