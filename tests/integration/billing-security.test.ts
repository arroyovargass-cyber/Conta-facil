import { beforeAll, afterAll, it, expect } from "vitest";
import { workspace } from "../support/workspace";
import { scoped, type Claims } from "../../apps/api/src/db";
import { randomUUID } from "node:crypto";
let f: Awaited<ReturnType<typeof workspace>>,
  claims: Claims,
  a: string,
  b: string,
  customer: string,
  draft: string;
beforeAll(async () => {
  f = await workspace({ role: "billing", companies: 2 });
  const session = randomUUID();
  await f.pool.query(
    "insert into private.sessions(id,user_id,auth_session_id,encrypted_tokens,csrf_hash,expires_at) values($1,$2,$3,'test','test',now()+interval '1 hour')",
    [randomUUID(), f.userId, session],
  );
  claims = { sub: f.userId, aal: "aal2", session_id: session };
  [a, b] = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'A'),($1,'B') returning id",
      [f.tenants[0]],
    )
  ).rows.map((r) => r.id);
  await f.pool.query(
    "update public.memberships set scope='departments' where user_id=$1",
    [f.userId],
  );
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [f.tenants[0], f.userId, a],
  );
});
afterAll(async () => {
  await f?.pool.end();
});
it("shares company catalog with departmental members and rejects cross-tenant references", async () => {
  customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Cliente') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  expect(
    await scoped(f.pool, claims, async (db) =>
      (await db.query("select id from public.customers")).rows.map((r) => r.id),
    ),
  ).toContain(customer);
  await expect(
    f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,created_by,updated_by,operation_id,request_hash,customer_snapshot) values($1,$2,$3,'CRC',$4,$4,$5,'test','{}')",
      [f.tenants[1], customer, a, f.userId, randomUUID()],
    ),
  ).rejects.toMatchObject({ code: "23503" });
});
it("hides drafts and lines in other departments including direct SQL", async () => {
  for (const dep of [a, b]) {
    const id = (
      await f.pool.query(
        "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,created_by,updated_by,operation_id,request_hash,customer_snapshot) values($1,$2,$3,'CRC',$4,$4,$5,'test','{}') returning id",
        [f.tenants[0], customer, dep, f.userId, randomUUID()],
      )
    ).rows[0].id;
    await f.pool.query(
      "insert into public.invoice_draft_lines(tenant_id,draft_id,position,description,quantity,unit_price) values($1,$2,1,'Servicio',1,2)",
      [f.tenants[0], id],
    );
    if (dep === a) draft = id;
  }
  expect(
    await scoped(f.pool, claims, async (db) =>
      (await db.query("select id from public.invoice_drafts")).rows.map(
        (r) => r.id,
      ),
    ),
  ).toEqual([draft]);
  expect(
    await scoped(f.pool, claims, async (db) =>
      (
        await db.query("select draft_id from public.invoice_draft_lines")
      ).rows.map((r) => r.draft_id),
    ),
  ).toEqual([draft]);
});
it("denies catalog writes without permission and draft writes without MFA", async () => {
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(
        "insert into public.customers(tenant_id,name) values($1,'Denied')",
        [f.tenants[0]],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    scoped(f.pool, { ...claims, aal: "aal1" }, (db) =>
      db.query("update public.invoice_drafts set notes='Denied' where id=$1", [
        draft,
      ]),
    ),
  ).resolves.toMatchObject({ rowCount: 0 });
});
it("denies reassignment to unauthorized department and revoked sessions", async () => {
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(
        "update public.invoice_drafts set department_id=$1 where id=$2",
        [b, draft],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await f.pool.query(
    "update private.sessions set revoked_at=now() where auth_session_id=$1",
    [claims.session_id],
  );
  expect(
    await scoped(
      f.pool,
      claims,
      async (db) => (await db.query("select * from public.customers")).rowCount,
    ),
  ).toBe(0);
});
