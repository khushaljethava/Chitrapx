import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export { schema };
export type Db = NodePgDatabase<typeof schema>;
/** A transaction: Drizzle for queries, the raw client so pg-boss can enqueue on the same connection. */
export type Tx = { db: Db; client: pg.PoolClient };

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
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
