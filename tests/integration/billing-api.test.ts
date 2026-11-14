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
  dep: string,
  customer: any,
  product: any,
  draft: any;
const request = (
  path: string,
  method = "GET",
  payload?: any,
  tenant?: string,
) =>
  app.inject({
    method: method as any,
    url: "/api/companies/" + (tenant ?? f.tenants[0]) + path,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
beforeAll(async () => {
  f = await workspace({ role: "billing", companies: 2 });
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,p from public.roles cross join unnest(array['customers.manage','catalog.manage']) p where tenant_id=$1 and code='billing' on conflict do nothing",
    [f.tenants[0]],
  );
  dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
  const enroll = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
  });
  const verify = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload: {
      factorId: enroll.json().factorId,
      code: totp(enroll.json().secret),
    },
  });
  expect(verify.statusCode, verify.body).toBe(200);
  const session = await app.inject({
    url: "/api/auth/session",
    headers: { cookie },
  });
  csrf = session.json().csrf;
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
it("creates and updates tenant catalogs with versions and literal search", async () => {
  const c = await request("/customers", "POST", {
    name: "100% Cliente",
    identification_type: "juridica",
    identification: "3-ABC-123",
  });
  expect(c.statusCode, c.body).toBe(200);
  customer = c.json().item;
  const p = await request("/catalog-items", "POST", {
    code: "S1",
    description: "Servicio",
    kind: "service",
    currency: "CRC",
    unit_price: "0.2",
  });
  expect(p.statusCode, p.body).toBe(200);
  product = p.json().item;
  expect(
    (await request("/customers?search=100%25"))
      .json()
      .items.map((x: any) => x.id),
  ).toEqual([customer.id]);
  expect(
    (await request("/customers/" + customer.id, "GET", undefined, f.tenants[1]))
      .statusCode,
  ).toBe(404);
  const update = await request("/customers/" + customer.id, "PATCH", {
    name: "Cliente actualizado",
    version: 1,
  });
  expect(update.statusCode, update.body).toBe(200);
  customer = update.json().item;
  expect(customer.identification).toBe("3-ABC-123");
  expect(
    (
      await request("/customers/" + customer.id, "PATCH", {
        name: "Viejo",
        version: 1,
      })
    ).statusCode,
  ).toBe(409);
});
const payload = () => ({
  operation_id: randomUUID(),
  customer_id: customer.id,
  department_id: dep,
  currency: "CRC",
  notes: "Prueba",
  lines: [
    {
      catalog_item_id: product.id,
      description: "Servicio",
      quantity: "0.1",
      unit_price: "0.2",
    },
  ],
});
it("creates one draft under concurrent retries and rejects changed request", async () => {
  const input = payload();
  const results = await Promise.all([
    request("/invoice-drafts", "POST", input),
    request("/invoice-drafts", "POST", input),
  ]);
  for (const r of results) expect(r.statusCode, r.body).toBe(200);
  expect(results[0].json().item.id).toBe(results[1].json().item.id);
  draft = results[0].json().item;
  expect(draft.subtotal).toBe("0.02");
  expect(draft.customer_snapshot.name).toBe("Cliente actualizado");
  expect(
    (await request("/invoice-drafts", "POST", { ...input, notes: "Diferente" }))
      .statusCode,
  ).toBe(409);
});
it("preserves historical copies and inactive references until explicitly edited", async () => {
  const c = await request("/customers/" + customer.id, "PATCH", {
    name: "Nombre posterior",
    active: false,
    version: customer.version,
  });
  expect(c.statusCode, c.body).toBe(200);
  const p = await request("/catalog-items/" + product.id, "PATCH", {
    description: "Cambio posterior",
    active: false,
    version: product.version,
  });
  expect(p.statusCode, p.body).toBe(200);
  const read = await request("/invoice-drafts/" + draft.id);
  expect(read.json().item.customer_snapshot.name).toBe("Cliente actualizado");
  expect(read.json().item.lines[0].description).toBe("Servicio");
  expect((await request("/invoice-drafts", "POST", payload())).statusCode).toBe(
    400,
  );
  const { operation_id, ...edit } = payload();
  const r = await request("/invoice-drafts/" + draft.id, "PATCH", {
    ...edit,
    version: draft.version,
    notes: "Editado",
  });
  expect(r.statusCode, r.body).toBe(200);
  draft = r.json().item;
  expect(draft.customer_snapshot.name).toBe("Cliente actualizado");
});
it("rejects stale concurrent writes, archives, restores and rolls back invalid lines", async () => {
  const { operation_id, ...edit } = payload();
  const writes = await Promise.all(
    ["Uno", "Dos"].map((notes) =>
      request("/invoice-drafts/" + draft.id, "PATCH", {
        ...edit,
        notes,
        version: draft.version,
      }),
    ),
  );
  expect(writes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  draft = writes.find((r) => r.statusCode === 200)!.json().item;
  const invalid = await request("/invoice-drafts/" + draft.id, "PATCH", {
    ...edit,
    version: draft.version,
    lines: [...edit.lines, { ...edit.lines[0], catalog_item_id: randomUUID() }],
  });
  expect(invalid.statusCode).toBe(400);
  expect(
    (await request("/invoice-drafts/" + draft.id)).json().item.version,
  ).toBe(draft.version);
  let r = await request("/invoice-drafts/" + draft.id, "PATCH", {
    version: draft.version,
    archived: true,
  });
  expect(r.statusCode, r.body).toBe(200);
  draft = r.json().item;
  expect(
    (
      await request("/invoice-drafts/" + draft.id, "PATCH", {
        ...edit,
        version: draft.version,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await request("/invoice-drafts?archived=false")).json().items,
  ).toHaveLength(0);
  r = await request("/invoice-drafts/" + draft.id, "PATCH", {
    version: draft.version,
    archived: false,
  });
  expect(r.statusCode, r.body).toBe(200);
  draft = r.json().item;
});
it("paginates catalogs and rejects foreign references, fiscal fields and currency mismatch", async () => {
  for (let i = 0; i < 55; i++)
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,$2)",
      [f.tenants[0], "Paginado " + String(i).padStart(2, "0")],
    );
  const first = (await request("/customers?search=Paginado")).json();
  expect(first.items).toHaveLength(50);
  expect(
    (
      await request("/customers?search=Paginado&cursor=" + first.nextCursor)
    ).json().items,
  ).toHaveLength(5);
  expect(
    (
      await request("/invoice-drafts", "POST", {
        ...payload(),
        status: "accepted",
      })
    ).statusCode,
  ).toBe(400);
  await request("/customers/" + customer.id, "PATCH", {
    active: true,
    version: 3,
  });
  await request("/catalog-items/" + product.id, "PATCH", {
    active: true,
    version: 2,
  });
  expect(
    (
      await request("/invoice-drafts", "POST", {
        ...payload(),
        currency: "USD",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await request("/invoice-drafts", "POST", payload(), f.tenants[1]))
      .statusCode,
  ).toBeGreaterThanOrEqual(400);
});
it("returns only authorized departments and rejects reassignment to unauthorized destination", async () => {
  const other = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Privado') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  await f.pool.query(
    "update public.memberships set scope='departments' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [f.tenants[0], f.userId, dep],
  );
  const options = await request("/invoice-options");
  expect(options.statusCode, options.body).toBe(200);
  expect(options.json().departments.map((x: any) => x.id)).toEqual([dep]);
  expect(options.json().canManage).toBe(true);
  const { operation_id, ...edit } = payload();
  expect(
    (
      await request("/invoice-drafts/" + draft.id, "PATCH", {
        ...edit,
        department_id: other,
        version: draft.version,
      })
    ).statusCode,
  ).toBe(403);
});
