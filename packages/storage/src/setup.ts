import {
  CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, type LifecycleRule,
} from "@aws-sdk/client-s3";
import type { StorageConfig } from "./config.ts";
import { s3Client } from "./s3.ts";
import { STAGING_PREFIX, type Bucket } from "./types.ts";

/** Exports (ZIPs, PNGs, MP4s, project files) are deleted this many days after they are written. */
export const EXPORT_RETENTION_DAYS = 30;

const notImplemented = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotImplemented" || e?.$metadata?.httpStatusCode === 501;
};

/** Creates both buckets if missing, then (re)applies CORS and lifecycle rules. Idempotent. Returns what it did. */
export async function ensureBuckets(config: StorageConfig, webOrigin: string): Promise<string[]> {
  const client = s3Client(config);
  const log: string[] = [];
  for (const b of ["uploads", "exports"] as Bucket[]) {
    const Bucket = config.buckets[b];
    try { await client.send(new HeadBucketCommand({ Bucket })); }
    catch { await client.send(new CreateBucketCommand({ Bucket })); log.push(`created ${Bucket}`); }
    try {
      await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [{
        AllowedOrigins: [new URL(webOrigin).origin], AllowedMethods: ["PUT", "GET", "HEAD"],
        AllowedHeaders: ["content-type", "content-length", "if-none-match"], MaxAgeSeconds: 3600,
      }] } }));
      log.push(`${Bucket}: CORS for ${webOrigin}`);
    } catch (err) {
      if (!notImplemented(err)) throw err;
      log.push(`${Bucket}: CORS API not supported here (MinIO); set MINIO_API_CORS_ALLOW_ORIGIN instead`);
    }
    const rule: LifecycleRule = b === "uploads"
      ? { ID: "staging-1-day", Status: "Enabled", Filter: { Prefix: STAGING_PREFIX }, Expiration: { Days: 1 } }
      : { ID: `exports-${EXPORT_RETENTION_DAYS}-days`, Status: "Enabled", Filter: { Prefix: "" }, Expiration: { Days: EXPORT_RETENTION_DAYS } };
    await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket, LifecycleConfiguration: { Rules: [rule] } }));
    log.push(`${Bucket}: lifecycle ${rule.ID}`);
  }
  return log;
}
