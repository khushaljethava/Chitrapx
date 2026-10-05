import { grantMonthlyCredits, pool, type JobType } from "@chitrapx/db";
import { boss } from "./boss.ts";
import { cleanups, handlers } from "./handlers.ts";
import { runJob, sweepAbandonedJobs } from "./runJob.ts";
import { storageConfig } from "@chitrapx/storage";
storageConfig(); // a worker without storage settings stops here, naming the variable

boss.on("error", (err) => console.error("[pg-boss]", err));
await boss.start();

for (const type of Object.keys(handlers) as JobType[]) {
  await boss.createQueue(type);
  // ponytail: one process, 4 concurrent jobs per type (1 for bundles and imports, ~1 GB each at peak); scale by running more worker containers.
  const localConcurrency = type === "project_bundle" || type === "project_import" ? 1 : 4;
  await boss.work<{ jobId: string }>(type, { localConcurrency, pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await runJob(job.data.jobId, handlers[type], cleanups[type]);
  });
}

await boss.createQueue("grant_monthly_credits");
await boss.schedule("grant_monthly_credits", "0 3 * * *");
await boss.work("grant_monthly_credits", async () => {
  console.log(`[grants] ${await grantMonthlyCredits()} workspaces granted`);
});

await boss.createQueue("sweep_abandoned_jobs");
await boss.schedule("sweep_abandoned_jobs", "*/5 * * * *");
await boss.work("sweep_abandoned_jobs", async () => {
  const n = await sweepAbandonedJobs(cleanups);
  if (n) console.log(`[sweep] failed and refunded ${n} abandoned jobs`);
});

console.log(`[worker] ready: ${Object.keys(handlers).join(", ")}`);

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal}, finishing in-flight jobs`);
    // AI designs can take a couple of minutes; give in-flight jobs time to finish on deploys.
    await boss.stop({ graceful: true, timeout: 180_000 });
    await pool.end();
    process.exit(0);
  });
}
