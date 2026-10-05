import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuckets, s3Storage, storageConfig, storageOrigin, type StorageConfig } from "../src/index.ts";
import { storageContract } from "./contract.ts";

beforeAll(async () => {
  const live = await fetch(`${process.env.S3_ENDPOINT}/minio/health/live`).catch(() => null);
  if (!live?.ok) throw new Error("MinIO not reachable at S3_ENDPOINT; run pnpm storage:up && pnpm storage:setup");
  await ensureBuckets(storageConfig(), process.env.WEB_ORIGIN ?? "http://localhost:3000");
});

storageContract("s3 (MinIO)", () => s3Storage(), true);

describe("storage config and origin", () => {
  it("signed URLs point at storageOrigin()", async () => {
    const [url] = await s3Storage().signedUrls(["any/key"]);
    expect(new URL(url!).origin).toBe(await storageOrigin());
  });
  it("names the missing variable", () => {
    expect(() => storageConfig({ S3_REGION: "eu-west-1" })).toThrow(/S3_ACCESS_KEY_ID/);
  });
  it("uses the AWS virtual-host origin per bucket when there is no endpoint", async () => {
    const aws: StorageConfig = { region: "eu-west-1", accessKeyId: "a", secretAccessKey: "b", forcePathStyle: false, buckets: { uploads: "u-bkt", exports: "e-bkt" } };
    expect(await storageOrigin("uploads", aws)).toBe("https://u-bkt.s3.eu-west-1.amazonaws.com");
    expect(await storageOrigin("uploads", { ...aws, forcePathStyle: true })).toBe("https://s3.eu-west-1.amazonaws.com");
    expect(await storageOrigin("uploads", { ...aws, endpoint: "https://acc.r2.cloudflarestorage.com", forcePathStyle: true })).toBe("https://acc.r2.cloudflarestorage.com");
  });
  it("matches what the SDK signs for dotted bucket names (M7)", async () => {
    const aws: StorageConfig = { region: "eu-west-1", accessKeyId: "a", secretAccessKey: "b", forcePathStyle: false, buckets: { uploads: "uploads.example.com", exports: "e" } };
    const [url] = await s3Storage(aws).signedUrls(["any/key"]);
    expect(await storageOrigin("uploads", aws)).toBe(new URL(url!).origin);
    expect(await storageOrigin("uploads", aws)).not.toBe("https://uploads.example.com.s3.eu-west-1.amazonaws.com");
  });
});
