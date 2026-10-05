export type Bucket = "uploads" | "exports";
export const UPLOADS_BUCKET: Bucket = "uploads";
export const EXPORTS_BUCKET: Bucket = "exports";
/** Client uploads land here first; a lifecycle rule deletes leftovers after a day. */
export const STAGING_PREFIX = "staging/";

export class ObjectMissingError extends Error {
  constructor(public path: string) { super(`object missing: ${path}`); this.name = "ObjectMissingError"; }
}

/** All object storage Chitrapx uses: S3/R2/MinIO in production, in memory in tests. */
export interface ObjectStorage {
  /** A 10-minute URL that creates `path` once, at exactly `contentLength` bytes. Send `headers` with the PUT. */
  presignPut(path: string, opts: { contentType: string; contentLength: number; bucket?: Bucket }): Promise<{ url: string; headers: Record<string, string> }>;
  download(path: string, bucket?: Bucket): Promise<Buffer>;
  /** The object as a stream, so large files are never held in memory. */
  downloadStream(path: string, bucket?: Bucket): Promise<ReadableStream<Uint8Array>>;
  put(path: string, bytes: Uint8Array, contentType: string, bucket?: Bucket): Promise<void>;
  remove(path: string, bucket?: Bucket): Promise<void>;
  exists(path: string, bucket?: Bucket): Promise<boolean>;
  /** Fails if `to` already exists. `contentType` replaces the stored type (validated uploads get their sniffed type). */
  move(from: string, to: string, opts?: { contentType?: string; bucket?: Bucket }): Promise<void>;
  /** 1-hour GET links, in order. */
  signedUrls(paths: string[], bucket?: Bucket): Promise<string[]>;
  /** A 5-minute link that downloads `path` (exports bucket by default) under `filename`. */
  signedDownload(path: string, filename: string, bucket?: Bucket): Promise<string>;
}
