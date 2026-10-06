import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/client.ts";
import { asUser, createUser, makeWorkspace } from "./helpers.ts";

type Ids = { user: string; ws: string; app: string; project: string; ref2: string };

async function seedWorkspace(): Promise<Ids> {
  const user = (await createUser()).id;
  const ws = await makeWorkspace(user);
  await pool.query("insert into profiles (id, name) values ($1, 'x')", [user]);
  const app = (await pool.query("insert into apps (workspace_id, name) values ($1, 'App') returning id", [ws])).rows[0].id;
  const project = (await pool.query("insert into projects (workspace_id, app_id, name, kind, doc) values ($1, $2, 'P', 'screenshots', '{}') returning id", [ws, app])).rows[0].id;
  await pool.query("insert into project_versions (workspace_id, project_id, revision, doc) values ($1, $2, 1, '{}')", [ws, project]);
  await pool.query("insert into assets (workspace_id, app_id, kind, storage_path, mime, bytes, sha256) values ($1, $2, 'screenshot', 'p', 'image/png', 1, $3)", [ws, app, randomUUID()]);
  await pool.query("insert into jobs (workspace_id, type, credits_reserved) values ($1, 'noop', 1)", [ws]);
  await pool.query("insert into credit_ledger (workspace_id, delta, reason) values ($1, 50, 'plan_grant')", [ws]);
  await pool.query("insert into screen_insights (workspace_id, sha256, insight, model) values ($1, $2, '{}', 'm')", [ws, randomUUID()]);
  const refAsset = "insert into assets (workspace_id, app_id, kind, storage_path, mime, bytes, sha256) values ($1, $2, 'reference', 'p', 'image/png', 1, $3) returning id";
  const ref = (await pool.query(refAsset, [ws, app, randomUUID()])).rows[0].id;
  const ref2 = (await pool.query(refAsset, [ws, app, randomUUID()])).rows[0].id;
  await pool.query("insert into reference_insights (workspace_id, asset_id, insight, model) values ($1, $2, '{}', 'm')", [ws, ref]);
  return { user, ws, app, project, ref2 };
}

let a: Ids;
let b: Ids;
beforeAll(async () => { a = await seedWorkspace(); b = await seedWorkspace(); });

type Case = { table: string; where: (b: Ids) => string; set: string; insert: (b: Ids) => [string, unknown[]] };
const cases: Case[] = [
  { table: "workspaces", where: (b) => `id = '${b.ws}'`, set: "name = 'x'", insert: () => ["insert into workspaces (name, slug) values ('x', $1)", [randomUUID()]] },
  { table: "memberships", where: (b) => `workspace_id = '${b.ws}'`, set: "role = 'member'", insert: (b) => ["insert into memberships (workspace_id, user_id) values ($1, $2)", [b.ws, a.user]] },
  { table: "profiles", where: (b) => `id = '${b.user}'`, set: "name = 'x'", insert: (b) => ["insert into profiles (id) values ($1)", [b.user]] },
  { table: "apps", where: (b) => `workspace_id = '${b.ws}'`, set: "name = 'x'", insert: (b) => ["insert into apps (workspace_id, name) values ($1, 'x')", [b.ws]] },
  { table: "projects", where: (b) => `workspace_id = '${b.ws}'`, set: "name = 'x'", insert: (b) => ["insert into projects (workspace_id, app_id, name, kind, doc) values ($1, $2, 'x', 'screenshots', '{}')", [b.ws, b.app]] },
  { table: "project_versions", where: (b) => `workspace_id = '${b.ws}'`, set: "label = 'x'", insert: (b) => ["insert into project_versions (workspace_id, project_id, revision, doc) values ($1, $2, 2, '{}')", [b.ws, b.project]] },
  { table: "assets", where: (b) => `workspace_id = '${b.ws}'`, set: "mime = 'x'", insert: (b) => ["insert into assets (workspace_id, app_id, kind, storage_path, mime, bytes, sha256) values ($1, $2, 'image', 'p', 'image/png', 1, $3)", [b.ws, b.app, randomUUID()]] },
  { table: "jobs", where: (b) => `workspace_id = '${b.ws}'`, set: "attempts = 9", insert: (b) => ["insert into jobs (workspace_id, type, credits_reserved) values ($1, 'noop', 1)", [b.ws]] },
  { table: "screen_insights", where: (b) => `workspace_id = '${b.ws}'`, set: "model = 'x'", insert: (b) => ["insert into screen_insights (workspace_id, sha256, insight, model) values ($1, $2, '{}', 'm')", [b.ws, randomUUID()]] },
  { table: "reference_insights", where: (b) => `workspace_id = '${b.ws}'`, set: "model = 'x'", insert: (b) => ["insert into reference_insights (workspace_id, asset_id, insight, model) values ($1, $2, '{}', 'm')", [b.ws, b.ref2]] },
  { table: "credit_ledger", where: (b) => `workspace_id = '${b.ws}'`, set: "delta = 0", insert: (b) => ["insert into credit_ledger (workspace_id, delta, reason) values ($1, 1000, 'adjust')", [b.ws]] },
];

describe("RLS isolates workspaces", () => {
  for (const c of cases) {
    it(`${c.table}: A cannot read, insert, update or remove B's rows`, async () => {
      const read = await asUser(a.user, (db) => db.execute(sql.raw(`select 1 from ${c.table} where ${c.where(b)}`)));
      expect(read.rows).toHaveLength(0);

      const [text, values] = c.insert(b);
      await expect(asUser(a.user, (_db, c) => c.query(text, values))).rejects.toThrow();

      const upd = await asUser(a.user, (db) => db.execute(sql.raw(`update ${c.table} set ${c.set} where ${c.where(b)}`)));
      expect(upd.rowCount ?? 0).toBe(0);
      const del = await asUser(a.user, (db) => db.execute(sql.raw(`delete from ${c.table} where ${c.where(b)}`)));
      expect(del.rowCount ?? 0).toBe(0);
    });
  }

  it("A can read its own rows", async () => {
    const r = await asUser(a.user, (db) => db.execute(sql`select id from apps where workspace_id = ${a.ws}`));
    expect(r.rows).toHaveLength(1);
  });

  it("A can read its own competitor analyses (F13)", async () => {
    const r = await asUser(a.user, (db) => db.execute(sql`select id from reference_insights where workspace_id = ${a.ws}`));
    expect(r.rows).toHaveLength(1);
  });

  it("A cannot write credits or jobs even for its own workspace", async () => {
    await expect(asUser(a.user, (_db, c) => c.query("insert into credit_ledger (workspace_id, delta, reason) values ($1, 1000, 'adjust')", [a.ws]))).rejects.toThrow();
    await expect(asUser(a.user, (_db, c) => c.query("insert into jobs (workspace_id, type, credits_reserved) values ($1, 'noop', 0)", [a.ws]))).rejects.toThrow();
    const upd = await asUser(a.user, (db) => db.execute(sql`update credit_ledger set delta = 9999 where workspace_id = ${a.ws}`));
    expect(upd.rowCount ?? 0).toBe(0);
  });
});

describe("RLS: users cannot write their own workspace's rows either (all writes go through the server)", () => {
  it("cannot change their own plan or billing fields", async () => {
    const upd = await asUser(a.user, (db) => db.execute(sql`update workspaces set plan = 'studio', razorpay_customer_id = 'x' where id = ${a.ws}`));
    expect(upd.rowCount ?? 0).toBe(0);
  });

  const ownInserts: Array<[string, (a: Ids) => [string, unknown[]]]> = [
    ["apps", (a) => ["insert into apps (workspace_id, name) values ($1, 'x')", [a.ws]]],
    ["projects", (a) => ["insert into projects (workspace_id, app_id, name, kind, doc) values ($1, $2, 'x', 'screenshots', '{}')", [a.ws, a.app]]],
    ["projects pointing at B's app", (a) => ["insert into projects (workspace_id, app_id, name, kind, doc) values ($1, $2, 'x', 'screenshots', '{}')", [a.ws, b.app]]],
    ["project_versions", (a) => ["insert into project_versions (workspace_id, project_id, revision, doc) values ($1, $2, 9, '{}')", [a.ws, a.project]]],
    ["reference_insights (F13)", (a) => ["insert into reference_insights (workspace_id, asset_id, insight, model) values ($1, $2, '{}', 'm')", [a.ws, a.ref2]]],
    ["assets with a planted storage path", (a) => ["insert into assets (workspace_id, app_id, kind, storage_path, mime, bytes, sha256) values ($1, $2, 'image', $3, 'image/png', 1, $4)", [a.ws, a.app, `${b.ws}/x`, randomUUID()]]],
  ];
  for (const [name, insert] of ownInserts) {
    it(`cannot insert ${name}`, async () => {
      const [text, values] = insert(a);
      await expect(asUser(a.user, (_db, c) => c.query(text, values))).rejects.toThrow();
    });
  }

  for (const [table, set] of [["apps", "name = 'x'"], ["projects", "name = 'x'"], ["assets", "storage_path = 'x'"], ["profiles", "name = 'x'"]] as const) {
    it(`cannot update own ${table}`, async () => {
      const where = table === "profiles" ? sql.raw(`id = '${a.user}'`) : sql.raw(`workspace_id = '${a.ws}'`);
      const upd = await asUser(a.user, (db) => db.execute(sql`update ${sql.raw(table)} set ${sql.raw(set)} where ${where}`));
      expect(upd.rowCount ?? 0).toBe(0);
    });
  }
});

describe("RLS: community feed and analytics (SP16, migration 0013)", () => {
  type Posts = { published: string; hidden: string; removed: string };
  const post = async (ids: Ids, status: string) => (await pool.query(
    "insert into community_posts (author_id, workspace_id, title, category, kind, doc, status, license_accepted_at) values ($1, $2, 'T', 'screenshots', 'screenshots', '{}', $3, now()) returning id",
    [ids.user, ids.ws, status])).rows[0].id as string;
  let bp: Posts;
  let ap: Posts;
  beforeAll(async () => {
    bp = { published: await post(b, "published"), hidden: await post(b, "hidden"), removed: await post(b, "removed") };
    ap = { published: await post(a, "published"), hidden: await post(a, "hidden"), removed: await post(a, "removed") };
    for (const [p, reporter] of [[bp.published, a.user], [ap.published, b.user]] as const) {
      await pool.query("insert into community_reports (post_id, reporter_id, reason) values ($1, $2, 'spam')", [p, reporter]);
      await pool.query("insert into community_imports (post_id, user_id) values ($1, $2)", [p, reporter]);
    }
    await pool.query("insert into community_actions (post_id, staff_id, action) values ($1, $2, 'restore')", [bp.hidden, b.user]);
    await pool.query("insert into analytics_events (name, path) values ('page_view', '/')");
  });

  it("A reads B's published post but never B's hidden or removed ones, and all of its own", async () => {
    const seen = async (id: string) => (await asUser(a.user, (db) => db.execute(sql`select 1 from community_posts where id = ${id}`))).rows.length;
    expect(await seen(bp.published)).toBe(1);
    expect(await seen(bp.hidden)).toBe(0);
    expect(await seen(bp.removed)).toBe(0);
    expect(await seen(ap.hidden)).toBe(1);
  });

  it("A cannot publish, edit or remove posts, even its own", async () => {
    await expect(asUser(a.user, (_db, c) => c.query(
      "insert into community_posts (author_id, workspace_id, title, category, kind, doc, license_accepted_at) values ($1, $2, 'x', 'screenshots', 'screenshots', '{}', now())", [a.user, a.ws]))).rejects.toThrow();
    for (const id of [bp.published, ap.published]) {
      const upd = await asUser(a.user, (db) => db.execute(sql`update community_posts set status = 'published', import_count = 999 where id = ${id}`));
      expect(upd.rowCount ?? 0).toBe(0);
      const gone = await asUser(a.user, (db) => db.execute(sql.raw(`DELETE FROM community_posts WHERE id = '${id}'`)));
      expect(gone.rowCount ?? 0).toBe(0);
    }
  });

  it("reports and imports: A reads only its own rows and cannot write any", async () => {
    for (const table of ["community_reports", "community_imports"]) {
      const col = table === "community_reports" ? "reporter_id" : "user_id";
      const rows = await asUser(a.user, (db) => db.execute(sql.raw(`select ${col} as who from ${table}`)));
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(rows.rows.every((r) => (r as { who: string }).who === a.user)).toBe(true);
      const gone = await asUser(a.user, (db) => db.execute(sql.raw(`DELETE FROM ${table}`)));
      expect(gone.rowCount ?? 0).toBe(0);
    }
    await expect(asUser(a.user, (_db, c) => c.query("insert into community_reports (post_id, reporter_id, reason) values ($1, $2, 'x')", [bp.hidden, a.user]))).rejects.toThrow();
    await expect(asUser(a.user, (_db, c) => c.query("insert into community_imports (post_id, user_id) values ($1, $2)", [bp.hidden, a.user]))).rejects.toThrow();
  });

  it("the moderation log and analytics events are server-only", async () => {
    for (const table of ["community_actions", "analytics_events"]) {
      const rows = await asUser(a.user, (db) => db.execute(sql.raw(`select 1 from ${table}`)));
      expect(rows.rows).toHaveLength(0);
    }
    await expect(asUser(a.user, (_db, c) => c.query("insert into analytics_events (name) values ('x')"))).rejects.toThrow();
  });
});

describe("RLS: live co-editing command log and channel topics (SP15, migration 0015)", () => {
  const insert = "insert into project_commands (project_id, seq, workspace_id, client_id, client_seq, user_id, command) values ($1, $2, $3, $4, $5, $6, $7)";
  const row = (ids: Ids, seq: number) => [ids.project, seq, ids.ws, randomUUID(), 1, ids.user, JSON.stringify({ type: "setMirrorRtl", on: true })];
  beforeAll(async () => {
    await pool.query(insert, row(a, 1));
    await pool.query(insert, row(b, 1));
  });

  it("A cannot read, insert, update or delete B's commands", async () => {
    const read = await asUser(a.user, (db) => db.execute(sql`select 1 from project_commands where workspace_id = ${b.ws}`));
    expect(read.rows).toHaveLength(0);
    await expect(asUser(a.user, (_db, c) => c.query(insert, row(b, 2)))).rejects.toThrow();
    const upd = await asUser(a.user, (db) => db.execute(sql`update project_commands set client_seq = 9 where workspace_id = ${b.ws}`));
    expect(upd.rowCount ?? 0).toBe(0);
    const del = await asUser(a.user, (db) => db.execute(sql`delete from project_commands where workspace_id = ${b.ws}`));
    expect(del.rowCount ?? 0).toBe(0);
  });

  it("A reads its own project's log but cannot append to it (commands go through the server)", async () => {
    const read = await asUser(a.user, (db) => db.execute(sql`select seq from project_commands where project_id = ${a.project}`));
    expect(read.rows).toHaveLength(1);
    await expect(asUser(a.user, (_db, c) => c.query(insert, row(a, 2)))).rejects.toThrow();
  });

  it("can_use_project_topic admits members to both of their project's topics and nobody else", async () => {
    const can = async (topic: string) => (await asUser(a.user, (db) => db.execute<{ ok: boolean }>(sql`select public.can_use_project_topic(${topic}) as ok`))).rows[0]!.ok;
    expect(await can(`project:${a.project}`)).toBe(true);
    expect(await can(`project-live:${a.project}`)).toBe(true);
    expect(await can(`project:${b.project}`)).toBe(false);
    expect(await can(`project-live:${b.project}`)).toBe(false);
    expect(await can(`comments:${a.project}`)).toBe(false);
    expect(await can("project:not-a-uuid")).toBe(false);
    expect(await can(`project:${a.project}:x`)).toBe(false);
  });
});
