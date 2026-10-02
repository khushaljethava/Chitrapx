import { pool } from "@chitrapx/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const check = async (q: string) => {
    try { return (await pool.query(q)).rows[0]?.ok === true ? "ok" : "error"; } catch { return "error"; }
  };
  const [db, queue] = await Promise.all([
    check("select true as ok"),
    check("select to_regnamespace('pgboss') is not null as ok"),
  ]);
  return Response.json({ db, queue }, { status: db === "ok" && queue === "ok" ? 200 : 503 });
}
