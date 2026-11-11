import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export { schema };
export type Db = NodePgDatabase<typeof schema>;
/** A transaction: Drizzle for queries, the raw client so pg-boss can enqueue on the same connection. */
export type Tx = { db: Db; client: pg.PoolClient };

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

/**
 * Kept small: web and worker share Supabase's session pooler (15 clients by default), and pg-boss needs some too.
 * Reused across dev hot reloads, which would otherwise open a fresh pool each time. DB_POOL_MAX overrides the size.
 */
const g = globalThis as { __chitrapxPool?: pg.Pool };
export const pool = (g.__chitrapxPool ??= new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX) || 5 }));
export const db: Db = drizzle(pool, { schema });

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn({ db: drizzle(client, { schema }), client });
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
