import { it, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../apps/api/src/config";
it("runs ordinary authorization as authenticated while denying API role DDL and audit mutation", async () => {
  const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("set local role conta_facil_api");
    expect((await db.query("select current_user name")).rows[0].name).toBe(
      "conta_facil_api",
    );
    await db.query("select * from private.login_directory limit 1");
    await db.query("select * from public.memberships limit 1");
    await db.query("savepoint denied_ddl");
    await expect(
      db.query("create table public.api_ddl_probe(id int)"),
    ).rejects.toMatchObject({ code: "42501" });
    await db.query("rollback to savepoint denied_ddl");
    await db.query("savepoint denied_audit");
    await expect(
      db.query("delete from public.audit_events"),
    ).rejects.toMatchObject({ code: "42501" });
    await db.query("rollback to savepoint denied_audit");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: randomUUID(),
        session_id: randomUUID(),
        aal: "aal2",
      }),
    ]);
    expect((await db.query("select * from public.tenants")).rows).toEqual([]);
  } finally {
    await db.query("rollback");
    db.release();
    await pool.end();
  }
});
