import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "../src/client.ts";
import { PLANS } from "../src/plans.ts";
import { createUser, makeWorkspace } from "./helpers.ts";

const MIGRATION = new URL("../migrations/0014_sp15_collaboration.sql", import.meta.url);

/** The migration's role-conversion block, run against a scratch schema holding the pre-0014 type and table. */
function conversionBlock(): string[] {
  const sqlText = readFileSync(MIGRATION, "utf8");
  const block = sqlText.split("-- sp15:role-conversion:begin")[1]?.split("-- sp15:role-conversion:end")[0];
  if (!block) throw new Error("conversion markers missing");
  return block.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
}

describe("member_role conversion (migration 0014)", () => {
  it("maps member to editor, keeps owner, and leaves the column on the new four-role type", async () => {
    const client = await pool.connect();
    const schemaName = `sp15_${randomUUID().slice(0, 8)}`;
    try {
      await client.query("begin");
      await client.query(`create schema ${schemaName}`);
      await client.query(`set local search_path = ${schemaName}`);
      await client.query("create type member_role as enum ('owner', 'member')");
      await client.query("create table memberships (workspace_id uuid, user_id uuid, role member_role not null default 'owner')");
      await client.query("insert into memberships values (gen_random_uuid(), gen_random_uuid(), 'owner'), (gen_random_uuid(), gen_random_uuid(), 'member')");
      for (const stmt of conversionBlock()) await client.query(stmt);
      const rows = (await client.query("select role::text as role from memberships")).rows.map((r) => r.role as string);
      expect(rows.sort()).toEqual(["editor", "owner"]);
      const labels = (await client.query(`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace where t.typname = 'member_role' and n.nspname = '${schemaName}' order by e.enumsortorder`)).rows.map((r) => r.enumlabel);
      expect(labels).toEqual(["owner", "admin", "editor", "viewer"]);
      const def = (await client.query("select column_default from information_schema.columns where table_schema = $1 and table_name = 'memberships' and column_name = 'role'", [schemaName])).rows[0].column_default;
      expect(def).toMatch(/viewer/);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("allows one owner per workspace", async () => {
    const owner = await createUser();
    const ws = await makeWorkspace(owner.id);
    const second = await createUser();
    await expect(pool.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [ws, second.id])).rejects.toThrow();
    await pool.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'admin')", [ws, second.id]);
  });
});

describe("seat limits", () => {
  it("every plan has seats, increasing with the plan", () => {
    expect(PLANS.free.maxSeats).toBe(1);
    expect(PLANS.pro.maxSeats).toBeGreaterThan(PLANS.free.maxSeats);
    expect(PLANS.studio.maxSeats).toBeGreaterThan(PLANS.pro.maxSeats);
  });
});
