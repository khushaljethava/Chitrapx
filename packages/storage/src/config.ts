import type { Bucket } from "./types.ts";

export type StorageConfig = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: Record<Bucket, string>;
  forcePathStyle: boolean;
};

/** Reads the S3 settings; throws naming the first missing variable, so a misconfigured deploy fails at startup. */
export function storageConfig(env: Record<string, string | undefined> = process.env): StorageConfig {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`Missing environment variable ${k} (object storage, see .env.example)`);
    return v;
  };
  return {
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    region: need("S3_REGION"),
    accessKeyId: need("S3_ACCESS_KEY_ID"),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    buckets: { uploads: need("S3_BUCKET_UPLOADS"), exports: need("S3_BUCKET_EXPORTS") },
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  };
}
