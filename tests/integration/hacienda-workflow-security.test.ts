import { beforeAll, afterAll, it, expect } from "vitest";
import { workspace } from "../support/workspace";
import { scoped, type Claims } from "../../apps/api/src/db";
import { randomUUID } from "node:crypto";
let f: Awaited<ReturnType<typeof workspace>>, claims: Claims;
beforeAll(async () => {
  f = await workspace({ role: "accountant", companies: 2 });
  const session = randomUUID();
  await f.pool.query(
    "insert into private.sessions(id,user_id,auth_session_id,encrypted_tokens,csrf_hash,expires_at) values($1,$2,$3,'test','test',now()+interval '1 hour')",
    [randomUUID(), f.userId, session],
  );
  claims = { sub: f.userId, aal: "aal2", session_id: session };
});
afterAll(async () => {
  await f?.pool.end();
});
it("keeps encrypted credential versions private even from authenticated users", async () => {
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query("select * from private.hacienda_credential_versions"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await scoped(f.pool, claims, (db) =>
        db.query("select * from public.hacienda_configuration"),
      )
    ).rows,
  ).toEqual([]);
});
it("does not grant workflow access or create departments on migration", async () => {
  expect(
    (
      await scoped(f.pool, claims, (db) =>
        db.query("select * from public.document_work_items"),
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await f.pool.query(
        "select * from public.departments where tenant_id=any($1::uuid[])",
        [f.tenants],
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(
        "insert into public.document_routes(tenant_id,flow) values($1,'collections')",
        [f.tenants[0]],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("enforces composite company references for route destinations", async () => {
  const dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Destino externo') returning id",
      [f.tenants[1]],
    )
  ).rows[0].id;
  await expect(
    f.pool.query(
      "insert into public.document_routes(tenant_id,flow,target_department_id) values($1,'collections',$2)",
      [f.tenants[0], dep],
    ),
  ).rejects.toMatchObject({ code: "23503" });
});
it("requires MFA and an explicit company-wide Hacienda permission for metadata", async () => {
  await f.pool.query(
    "insert into public.hacienda_configuration(tenant_id) values($1)",
    [f.tenants[0]],
  );
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,'hacienda.read' from public.roles where tenant_id=$1 and code='accountant'",
    [f.tenants[0]],
  );
  const read = (c: Claims) =>
    scoped(f.pool, c, (db) =>
      db.query("select tenant_id from public.hacienda_configuration"),
    );
  expect((await read({ ...claims, aal: "aal1" })).rows).toHaveLength(0);
  expect((await read(claims)).rows).toEqual([{ tenant_id: f.tenants[0] }]);
  await f.pool.query(
    "update public.memberships set scope='departments' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  expect((await read(claims)).rows).toHaveLength(0);
  await f.pool.query(
    "update public.memberships set scope='company' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
});
it("blocks deactivation of a department used by an enabled route", async () => {
  const dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Destino activo') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.document_routes(tenant_id,flow,target_department_id,enabled) values($1,'collections',$2,true)",
    [f.tenants[0], dep],
  );
  await expect(
    f.pool.query("update public.departments set active=false where id=$1", [
      dep,
    ]),
  ).rejects.toThrow("enabled document route");
  await f.pool.query(
    "update public.document_routes set enabled=false where tenant_id=$1",
    [f.tenants[0]],
  );
  await f.pool.query("update public.departments set active=false where id=$1", [
    dep,
  ]);
});
it("rejects same-company source department aliases and unconfigured destinations", async () => {
  const tenant = f.tenants[1];
  const deps = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Origen real'),($1,'Origen simulado'),($1,'CxC') returning id",
      [tenant],
    )
  ).rows.map((r) => r.id);
  const customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Cliente sintético') returning id",
      [tenant],
    )
  ).rows[0].id;
  const draft = (
    await f.pool.query(
      `insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{"name":"Cliente sintético"}',$4,$4,$5,'synthetic') returning id`,
      [tenant, customer, deps[0], f.userId, randomUUID()],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.document_routes(tenant_id,flow,target_department_id,enabled) values($1,'collections',$2,true)",
    [tenant, deps[2]],
  );
  const insert = (origin: string, target: string) =>
    f.pool.query(
      "insert into public.document_work_items(tenant_id,source_id,source_department_id,source_version,current_version,target_department_id,customer_name,created_by) values($1,$2,$3,1,1,$4,'Cliente sintético',$5)",
      [tenant, draft, origin, target, f.userId],
    );
  await expect(insert(deps[1], deps[2])).rejects.toMatchObject({
    code: "23514",
  });
  await expect(insert(deps[0], deps[1])).rejects.toMatchObject({
    code: "23514",
  });
  await insert(deps[0], deps[2]);
  await f.pool.query("update public.invoice_drafts set version=2 where id=$1", [
    draft,
  ]);
  expect(
    (
      await f.pool.query(
        "select source_version,current_version,version from public.document_work_items where source_id=$1",
        [draft],
      )
    ).rows[0],
  ).toEqual({ source_version: 1, current_version: 2, version: 2 });
});
it("checks active membership, profile, destination scope and flow permission without requiring an assignee session", async () => {
  const tenant = f.tenants[0],
    dep = (
      await f.pool.query(
        "insert into public.departments(tenant_id,name) values($1,'Responsables') returning id",
        [tenant],
      )
    ).rows[0].id;
  const configure = () =>
    f.pool.query(
      "update public.document_routes set target_department_id=$2,assignee_id=$3,enabled=true where tenant_id=$1 and flow='collections'",
      [tenant, dep, f.userId],
    );
  await expect(configure()).rejects.toMatchObject({ code: "23514" });
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,'collections.read' from public.roles where tenant_id=$1 and code='accountant'",
    [tenant],
  );
  await configure();
  await f.pool.query(
    "update public.memberships set scope='departments' where tenant_id=$1 and user_id=$2",
    [tenant, f.userId],
  );
  await expect(configure()).rejects.toMatchObject({ code: "23514" });
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [tenant, f.userId, dep],
  );
  await configure();
  await f.pool.query("update public.profiles set active=false where id=$1", [
    f.userId,
  ]);
  await expect(configure()).rejects.toMatchObject({ code: "23514" });
  await f.pool.query("update public.profiles set active=true where id=$1", [
    f.userId,
  ]);
});
it("allows a destination reader to see its minimal task without opening the source draft", async () => {
  const tenant = f.tenants[1];
  const item = (
    await f.pool.query(
      "select target_department_id from public.document_work_items where tenant_id=$1",
      [tenant],
    )
  ).rows[0];
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,'collections.read' from public.roles where tenant_id=$1 and code='accountant'",
    [tenant],
  );
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission='invoices.read'",
    [tenant],
  );
  await f.pool.query(
    "update public.memberships set scope='departments' where tenant_id=$1 and user_id=$2",
    [tenant, f.userId],
  );
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [tenant, f.userId, item.target_department_id],
  );
  const result = await scoped(f.pool, claims, async (db) => ({
    tasks: (
      await db.query(
        "select * from public.document_work_items where tenant_id=$1",
        [tenant],
      )
    ).rows,
    drafts: (
      await db.query("select * from public.invoice_drafts where tenant_id=$1", [
        tenant,
      ])
    ).rows,
  }));
  expect(result.tasks).toHaveLength(1);
  expect(result.drafts).toHaveLength(0);
  expect(result.tasks[0]).not.toHaveProperty("total");
  expect(result.tasks[0]).not.toHaveProperty("lines");
  await f.pool.query(
    "delete from public.membership_departments where tenant_id=$1 and user_id=$2",
    [tenant, f.userId],
  );
  expect(
    (
      await scoped(f.pool, claims, (db) =>
        db.query(
          "select * from public.document_work_items where tenant_id=$1",
          [tenant],
        ),
      )
    ).rows,
  ).toHaveLength(0);
});
