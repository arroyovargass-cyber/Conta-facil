import { it, expect } from "vitest";
import pg from "pg";
import { loadConfig } from "../../apps/api/src/config";
it("protects every internal table with backend-only RLS and explicit public grants", async () => {
  const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    const rows = (
      await pool.query(
        "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname in ('login_directory','platform_operators','sessions','rate_limits','access_events','invitations')",
      )
    ).rows;
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    const grants = (
      await pool.query(
        "select has_table_privilege('anon','public.tenants','SELECT') anon_read,has_table_privilege('authenticated','public.audit_events','DELETE') audit_delete,has_table_privilege('authenticated','private.sessions','SELECT') private_read",
      )
    ).rows[0];
    expect(grants).toEqual({
      anon_read: false,
      audit_delete: false,
      private_read: false,
    });
  } finally {
    await pool.end();
  }
});
