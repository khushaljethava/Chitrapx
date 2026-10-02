import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "../src/client.ts";
import { seedTemplates } from "../src/seed.ts";

it("seeds every bundled template and is idempotent", async () => {
  expect(await seedTemplates()).toBe(101);
  await seedTemplates();
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from templates where source = 'osg'`);
  expect(r.rows[0]!.n).toBe(101);
});
