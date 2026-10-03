import { PgBoss } from "pg-boss";

/** The worker's one queue connection; handlers that queue follow-up jobs use it. */
export const boss = new PgBoss(process.env.DATABASE_URL!);
