import { z } from "zod";
import type { ChitrapxDoc } from "./doc.ts";

/** Largest document we store or import. */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export const BUNDLE_FORMAT = "chitrapx-project";
export const BUNDLE_VERSION = 1;
/** The uploads bucket's limit; a larger file could not be imported. */
export const MAX_BUNDLE_BYTES = 500 * 1024 * 1024;
export const MAX_BUNDLE_ENTRIES = 500;

export const bundleManifestSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int(),
  docSchema: z.number().int(),
  appName: z.string().max(200),
  exportedAt: z.string().max(40),
  assets: z.array(z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["screenshot", "image", "recording"]),
    mime: z.string().max(100),
  })).max(MAX_BUNDLE_ENTRIES),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

const ASSET = /^asset:([0-9a-f-]{36})(#[a-z]+)?$/;
const BUNDLE = /^bundle:([a-f0-9]{64})(#[a-z]+)?$/;

/** Every string in the document through `fn`; documents are plain JSON. */
function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)])) as T;
  return value;
}
function collect(doc: ChitrapxDoc, re: RegExp): string[] {
  const found = new Set<string>();
  mapStrings(doc, (s) => { const m = re.exec(s); if (m) found.add(m[1]!); return s; });
  return [...found];
}

export const docAssetRefs = (doc: ChitrapxDoc) => collect(doc, ASSET);
export const docBundleRefs = (doc: ChitrapxDoc) => collect(doc, BUNDLE);

export function toBundleDoc(doc: ChitrapxDoc, shaOf: (assetId: string) => string | undefined): ChitrapxDoc {
  return mapStrings(doc, (s) => {
    const m = ASSET.exec(s);
    if (!m) return s;
    const sha = shaOf(m[1]!);
    if (!sha) throw new Error(`asset_missing:${m[1]}`);
    return `bundle:${sha}${m[2] ?? ""}`;
  });
}

export function fromBundleDoc(doc: ChitrapxDoc, idOf: (sha: string) => string | undefined): ChitrapxDoc {
  return mapStrings(doc, (s) => {
    const m = BUNDLE.exec(s);
    if (!m) return s;
    const id = idOf(m[1]!);
    if (!id) throw new Error("bundle_invalid");
    return `asset:${id}${m[2] ?? ""}`;
  });
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/x-m4v": "m4v" };
export const extFor = (mime: string) => EXT[mime] ?? "bin";
