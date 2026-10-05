import { s3Storage, type ObjectStorage } from "@chitrapx/storage";

let shared: ObjectStorage | null = null;
/** The worker's object storage, built once. */
export const storage = (): ObjectStorage => (shared ??= s3Storage());
