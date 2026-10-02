import { randomUUID } from "node:crypto";
import type pg from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pool, schema, type Db } from "../src/client.ts";

export async function createUser(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${id.slice(0, 8)}@test.local`;
  await pool.query("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')", [id, email]);
  return { id, email };
}

/** Workspace + owner membership inserted directly, bypassing onboarding. */
export async function makeWorkspace(userId: string, plan: "free" | "pro" | "studio" = "free"): Promise<string> {
  const id = randomUUID();
  await pool.query("insert into workspaces (id, name, slug, plan) values ($1, 'Test', $2, $3)", [id, `t-${id}`, plan]);
  await pool.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [id, userId]);
  return id;
}

/** Runs fn as the given user under RLS (role authenticated), always rolled back. */
export async function asUser<T>(userId: string, fn: (db: Db, client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    return await fn(drizzle(client, { schema }), client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

export async function ledgerSum(db: Db, workspaceId: string): Promise<number> {
  const r = await db.execute<{ s: number }>(sql`select coalesce(sum(delta), 0)::int as s from credit_ledger where workspace_id = ${workspaceId}`);
  return r.rows[0]!.s;
}
