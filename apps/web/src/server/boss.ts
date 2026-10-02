import "server-only";
import { PgBoss } from "pg-boss";

const g = globalThis as { __chitrapxBoss?: Promise<PgBoss> };

/** Send-only pg-boss for the web process: the worker owns maintenance, schedules and schema. */
export function getBoss(): Promise<PgBoss> {
  g.__chitrapxBoss ??= (async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, max: 2, supervise: false, schedule: false, migrate: false });
    boss.on("error", (err) => console.error("[pg-boss]", err));
    await boss.start();
    return boss;
  })();
  return g.__chitrapxBoss;
}
