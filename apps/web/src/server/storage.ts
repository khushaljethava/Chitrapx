import { s3Storage, type ObjectStorage } from "@chitrapx/storage";

export { EXPORTS_BUCKET, UPLOADS_BUCKET, type ObjectStorage } from "@chitrapx/storage";

let shared: ObjectStorage | null = null;
/** The app's object storage (S3, R2 or MinIO), built once per server process. */
export function appStorage(): ObjectStorage {
  return (shared ??= s3Storage());
}
