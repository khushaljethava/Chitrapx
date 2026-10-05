import {
  CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storageConfig, type StorageConfig } from "./config.ts";
import { ObjectMissingError, type Bucket, type ObjectStorage } from "./types.ts";

export function s3Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Default CRC32 checksums would be signed into presigned PUTs, which browsers cannot reproduce; R2/MinIO also reject some.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const isMissing = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
};
const copySource = (bucket: string, key: string) => `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

export function s3Storage(config: StorageConfig = storageConfig()): ObjectStorage {
  const client = s3Client(config);
  const B = (b: Bucket = "uploads") => config.buckets[b];
  const get = async (path: string, bucket?: Bucket) => {
    try { return await client.send(new GetObjectCommand({ Bucket: B(bucket), Key: path })); }
    catch (err) { if (isMissing(err)) throw new ObjectMissingError(path); throw err; }
  };
  const exists = async (path: string, bucket?: Bucket) => {
    try { await client.send(new HeadObjectCommand({ Bucket: B(bucket), Key: path })); return true; }
    catch (err) { if (isMissing(err)) return false; throw err; }
  };
  return {
    async presignPut(path, { contentType, contentLength, bucket }) {
      const cmd = new PutObjectCommand({ Bucket: B(bucket), Key: path, ContentType: contentType, ContentLength: contentLength, IfNoneMatch: "*" });
      const url = await getSignedUrl(client, cmd, { expiresIn: 600, signableHeaders: new Set(["content-type", "content-length", "if-none-match"]) });
      // Content-Length is signed too; browsers set it from the body and may not set it by hand.
      return { url, headers: { "Content-Type": contentType, "If-None-Match": "*" } };
    },
    async download(path, bucket) {
      const res = await get(path, bucket);
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async downloadStream(path, bucket) {
      const res = await get(path, bucket);
      return res.Body!.transformToWebStream() as ReadableStream<Uint8Array>;
    },
    async put(path, bytes, contentType, bucket) {
      await client.send(new PutObjectCommand({ Bucket: B(bucket), Key: path, Body: bytes, ContentType: contentType }));
    },
    async remove(path, bucket) {
      await client.send(new DeleteObjectCommand({ Bucket: B(bucket), Key: path }));
    },
    exists,
    async move(from, to, opts = {}) {
      if (await exists(to, opts.bucket)) throw new Error(`move target exists: ${to}`);
      try {
        await client.send(new CopyObjectCommand({
          Bucket: B(opts.bucket), Key: to, CopySource: copySource(B(opts.bucket), from),
          ...(opts.contentType ? { MetadataDirective: "REPLACE", ContentType: opts.contentType } : {}),
        }));
      } catch (err) { if (isMissing(err)) throw new ObjectMissingError(from); throw err; }
      await client.send(new DeleteObjectCommand({ Bucket: B(opts.bucket), Key: from }));
    },
    async signedUrls(paths, bucket) {
      return Promise.all(paths.map((p) => getSignedUrl(client, new GetObjectCommand({ Bucket: B(bucket), Key: p }), { expiresIn: 3600 })));
    },
    async signedDownload(path, filename, bucket = "exports") {
      const safe = filename.replace(/["\\\r\n]/g, "");
      return getSignedUrl(client, new GetObjectCommand({ Bucket: B(bucket), Key: path, ResponseContentDisposition: `attachment; filename="${safe}"` }), { expiresIn: 300 });
    },
  };
}
