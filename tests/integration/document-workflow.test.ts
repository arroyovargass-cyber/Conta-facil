import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { createApp } from "../../apps/api/src/app";
let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  draft = "",
  source = "",
  task = "",
  taskVersion = 1,
  routes: any[] = [];
const request = (
  path: string,
  method = "GET",
  payload?: Record<string, unknown>,
  tenant?: string,
) =>
  app.inject({
    method: method as any,
    url: "/api/companies/" + (tenant ?? f.tenants[0]) + path,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
beforeAll(async () => {
  f = await workspace({ role: "admin", companies: 2 });
  const guardian = await workspace({ role: "admin" });
  await f.pool.query(
    "insert into public.memberships(tenant_id,user_id,scope) values($1,$2,'company')",
    [f.tenants[0], guardian.userId],
  );
  await f.pool.query(
    "insert into public.membership_roles select tenant_id,$2,id from public.roles where tenant_id=$1 and code='admin'",
    [f.tenants[0], guardian.userId],
  );
  await guardian.pool.end();
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
  const enroll = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/mfa/verify",
        headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
        payload: {
          factorId: enroll.json().factorId,
          code: totp(enroll.json().secret),
        },
      })
    ).statusCode,
  ).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
  source = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  const customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Cliente documental') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  draft = (
    await f.pool.query(
      `insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{"name":"Cliente documental"}',$4,$4,$5,'synthetic') returning id`,
      [f.tenants[0], customer, source, f.userId, randomUUID()],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
it("explicitly creates the default destinations once without changing memberships", async () => {
  for (let i = 0; i < 2; i++) {
    const r = await request("/document-routes/setup", "POST", {});
    expect(r.statusCode, r.body).toBe(200);
  }
  routes = (await request("/document-routes")).json().items;
  expect(routes).toHaveLength(2);
  expect(routes.map((r) => r.department_name).sort()).toEqual([
    "Cuentas por cobrar",
    "Cuentas por pagar",
  ]);
  expect(
    (
      await f.pool.query(
        "select count(*)::int n from public.membership_departments where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("selects only eligible tenant assignees and protects route versions and foreign destinations", async () => {
  const r = routes.find((r) => r.flow === "collections");
  const eligible = await request(
    "/document-routes/eligible-assignees?flow=collections&department_id=" +
      r.target_department_id,
  );
  expect(eligible.statusCode, eligible.body).toBe(200);
  expect(eligible.json().items.map((u: any) => u.id)).toContain(f.userId);
  const updated = await request("/document-routes", "PATCH", {
    flow: "collections",
    expected_version: r.version,
    target_department_id: r.target_department_id,
    assignee_id: f.userId,
    enabled: true,
  });
  expect(updated.statusCode, updated.body).toBe(200);
  expect(
    (
      await request("/document-routes", "PATCH", {
        flow: "collections",
        expected_version: r.version,
        target_department_id: r.target_department_id,
        assignee_id: null,
        enabled: true,
      })
    ).statusCode,
  ).toBe(409);
});
it("assigns a clean saved draft idempotently and preserves its origin", async () => {
  const results = await Promise.all([
    request("/invoice-drafts/" + draft + "/collection-review", "POST", {
      expected_version: 1,
    }),
    request("/invoice-drafts/" + draft + "/collection-review", "POST", {
      expected_version: 1,
    }),
  ]);
  for (const r of results) expect(r.statusCode, r.body).toBe(200);
  expect(results[0].json()).toEqual(results[1].json());
  expect(Object.keys(results[0].json()).sort()).toEqual(["assigned", "id"]);
  task = results[0].json().id;
  expect(
    (
      await f.pool.query(
        "select department_id from public.invoice_drafts where id=$1",
        [draft],
      )
    ).rows[0].department_id,
  ).toBe(source);
  expect(
    (
      await request("/invoice-drafts/" + draft + "/collection-review", "POST", {
        expected_version: 9,
      })
    ).statusCode,
  ).toBe(409);
});
it("shows only task metadata and keeps payables explicitly empty until receipt exists", async () => {
  const inbox = await request("/document-work-items?flow=collections");
  expect(inbox.statusCode, inbox.body).toBe(200);
  expect(inbox.json().items).toHaveLength(1);
  expect(inbox.json().items[0]).toMatchObject({
    id: task,
    customer_name: "Cliente documental",
    state: "pending",
    needs_review: false,
  });
  for (const key of ["lines", "total", "currency", "pkcs12", "password"])
    expect(inbox.json().items[0]).not.toHaveProperty(key);
  const payables = await request("/document-work-items?flow=payables");
  expect(payables.json()).toMatchObject({
    items: [],
    receipt_status: "not_implemented",
  });
  expect(
    (
      await request(
        "/document-work-items?flow=collections",
        "GET",
        undefined,
        f.tenants[1],
      )
    ).json().items,
  ).toEqual([]);
});
it("requires current task and source versions before resolving a review", async () => {
  await f.pool.query(
    "update public.invoice_drafts set version=version+1 where id=$1",
    [draft],
  );
  const old = await request("/document-work-items/" + task, "PATCH", {
    expected_version: 1,
    expected_source_version: 1,
    state: "resolved",
    assignee_id: f.userId,
  });
  expect(old.statusCode, old.body).toBe(409);
  const row = (await request("/document-work-items?flow=collections")).json()
    .items[0];
  expect(row.needs_review).toBe(true);
  const done = await request("/document-work-items/" + task, "PATCH", {
    expected_version: row.version,
    expected_source_version: row.current_version,
    state: "resolved",
    assignee_id: f.userId,
  });
  expect(done.statusCode, done.body).toBe(200);
  expect(done.json().item).toMatchObject({
    state: "resolved",
    needs_review: false,
  });
  taskVersion = done.json().item.version;
  expect(
    (
      await request("/document-work-items/" + task, "PATCH", {
        expected_version: row.version,
        expected_source_version: row.current_version,
        state: "archived",
        assignee_id: f.userId,
      })
    ).statusCode,
  ).toBe(409);
});
it("rejects a foreign destination and keeps historical tasks in their original target", async () => {
  const route = (await request("/document-routes"))
    .json()
    .items.find((r: any) => r.flow === "collections");
  const foreign = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Destino externo') returning id",
      [f.tenants[1]],
    )
  ).rows[0].id;
  expect(
    (
      await request("/document-routes", "PATCH", {
        flow: "collections",
        expected_version: route.version,
        target_department_id: foreign,
        assignee_id: null,
        enabled: true,
      })
    ).statusCode,
  ).toBe(400);
  const alternate = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'CxC alterno') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  const changed = await request("/document-routes", "PATCH", {
    flow: "collections",
    expected_version: route.version,
    target_department_id: alternate,
    assignee_id: null,
    enabled: true,
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect(
    (
      await f.pool.query(
        "select target_department_id from public.document_work_items where id=$1",
        [task],
      )
    ).rows[0].target_department_id,
  ).toBe(route.target_department_id);
  const repeat = await request(
    "/invoice-drafts/" + draft + "/collection-review",
    "POST",
    { expected_version: 2 },
  );
  expect(repeat.json()).toEqual({ assigned: true, id: task });
});
it("lets destination managers review the task without reading origin documents or Hacienda", async () => {
  const target = (
    await f.pool.query(
      "select target_department_id from public.document_work_items where id=$1",
      [task],
    )
  ).rows[0].target_department_id;
  const role = (
    await f.pool.query(
      "insert into public.roles(tenant_id,code,name) values($1,'custom_destination','Destino de prueba') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.role_permissions values($1,$2,'collections.read'),($1,$2,'collections.manage')",
    [f.tenants[0], role],
  );
  await f.pool.query(
    "delete from public.membership_roles where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query("insert into public.membership_roles values($1,$2,$3)", [
    f.tenants[0],
    f.userId,
    role,
  ]);
  await f.pool.query(
    "update public.memberships set scope='departments' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [f.tenants[0], f.userId, target],
  );
  expect(
    (await request("/document-work-items?flow=collections")).json().items,
  ).toHaveLength(1);
  expect((await request("/invoice-drafts/" + draft)).statusCode).toBe(404);
  expect((await request("/hacienda")).statusCode).toBe(403);
  const people = await request(
    "/document-routes/eligible-assignees?flow=collections&department_id=" +
      target,
  );
  expect(people.statusCode, people.body).toBe(200);
  expect(people.json().items.map((p: any) => p.id)).toContain(f.userId);
  const updated = await request("/document-work-items/" + task, "PATCH", {
    expected_version: taskVersion,
    expected_source_version: 2,
    state: "in_review",
    assignee_id: f.userId,
  });
  expect(updated.statusCode, updated.body).toBe(200);
  await f.pool.query(
    "delete from public.membership_departments where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  expect(
    (await request("/document-work-items?flow=collections")).statusCode,
  ).toBe(403);
});
it("confirms assignment minimally for an origin actor without destination read permission", async () => {
  const role = (
    await f.pool.query(
      "insert into public.roles(tenant_id,code,name) values($1,'custom_origin','Origen de prueba') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.role_permissions values($1,$2,'invoices.read'),($1,$2,'invoices.manage'),($1,$2,'document_workflow.assign')",
    [f.tenants[0], role],
  );
  await f.pool.query(
    "delete from public.membership_roles where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query("insert into public.membership_roles values($1,$2,$3)", [
    f.tenants[0],
    f.userId,
    role,
  ]);
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [f.tenants[0], f.userId, source],
  );
  const copy = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) select tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,$2,'copy' from public.invoice_drafts where id=$1 returning id",
      [draft, randomUUID()],
    )
  ).rows[0].id;
  const response = await request(
    "/invoice-drafts/" + copy + "/collection-review",
    "POST",
    { expected_version: 1 },
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(Object.keys(response.json()).sort()).toEqual(["assigned", "id"]);
  expect(
    (await request("/document-work-items?flow=collections")).statusCode,
  ).toBe(403);
  expect((await request("/document-routes")).statusCode).toBe(403);
});
it("revokes inactive departmental access to historical tasks while retaining explicit company-wide history access", async () => {
  const target = (
    await f.pool.query(
      "select target_department_id from public.document_work_items where id=$1",
      [task],
    )
  ).rows[0].target_department_id;
  const role = (
    await f.pool.query(
      "select id from public.roles where tenant_id=$1 and code='custom_destination'",
      [f.tenants[0]],
    )
  ).rows[0].id;
  await f.pool.query(
    "delete from public.membership_roles where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query("insert into public.membership_roles values($1,$2,$3)", [
    f.tenants[0],
    f.userId,
    role,
  ]);
  await f.pool.query(
    "delete from public.membership_departments where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [f.tenants[0], f.userId, target],
  );
  const before = (await request("/document-work-items?flow=collections")).json()
    .items[0];
  const unassigned = await request("/document-work-items/" + task, "PATCH", {
    expected_version: before.version,
    expected_source_version: before.current_version,
    state: "pending",
    assignee_id: null,
  });
  expect(unassigned.statusCode, unassigned.body).toBe(200);
  await f.pool.query("update public.departments set active=false where id=$1", [
    target,
  ]);
  const read = await request("/document-work-items?flow=collections");
  const update = await request("/document-work-items/" + task, "PATCH", {
    expected_version: unassigned.json().item.version,
    expected_source_version: before.current_version,
    state: "archived",
    assignee_id: null,
  });
  const { scoped } = await import("../../apps/api/src/db");
  const session = (
    await f.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [f.userId],
    )
  ).rows[0].auth_session_id;
  const direct = await scoped(
    f.pool,
    { sub: f.userId, aal: "aal2", session_id: session },
    (db) =>
      db.query(
        "select id from public.document_work_items where tenant_id=$1 and target_department_id=$2",
        [f.tenants[0], target],
      ),
  );
  expect.soft([read.statusCode, update.statusCode]).toEqual([403, 403]);
  expect.soft(direct.rows).toHaveLength(0);
  await f.pool.query(
    "update public.memberships set scope='company' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  expect(
    (await request("/document-work-items?flow=collections"))
      .json()
      .items.map((r: any) => r.id),
  ).toContain(task);
});
