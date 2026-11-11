import { PgBoss } from "pg-boss";

/** The worker's one queue connection; handlers that queue follow-up jobs use it. */
// pg-boss opens 10 connections by default; 3 leaves room in the session pooler for the web app.
// LISTEN/NOTIFY (one extra dedicated connection) wakes workers on new jobs, so they barely need to poll.
export const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, max: 3, useListenNotify: true });
