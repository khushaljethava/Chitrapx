// Creates the upload and export buckets with CORS and lifecycle rules. Uses the S3_* variables from .env.
// Local: pnpm storage:up && pnpm storage:setup. Production: run once with the production env.
import { ensureBuckets, storageConfig } from "../src/index.ts";

const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
for (const line of await ensureBuckets(storageConfig(), origin)) console.log(line);
