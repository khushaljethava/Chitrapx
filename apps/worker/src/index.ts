import { PgBoss } from "pg-boss";
import { grantMonthlyCredits, pool, type JobType } from "@chitrapx/db";
import { handlers } from "./handlers.ts";
import { runJob } from "./runJob.ts";

const boss = new PgBoss(process.env.DATABASE_URL!);
boss.on("error", (err) => console.error("[pg-boss]", err));
await boss.start();

for (const type of Object.keys(handlers) as JobType[]) {
  await boss.createQueue(type);
  // ponytail: one process, 4 concurrent jobs per type; scale by running more worker containers.
  await boss.work<{ jobId: string }>(type, { localConcurrency: 4, pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await runJob(job.data.jobId, handlers[type]);
  });
}

await boss.createQueue("grant_monthly_credits");
await boss.schedule("grant_monthly_credits", "0 3 * * *");
await boss.work("grant_monthly_credits", async () => {
  console.log(`[grants] ${await grantMonthlyCredits()} workspaces granted`);
});

console.log(`[worker] ready: ${Object.keys(handlers).join(", ")}`);

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal}, finishing in-flight jobs`);
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
    process.exit(0);
  });
}
