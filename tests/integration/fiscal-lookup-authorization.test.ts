import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/app";
import { FiscalLookups } from "../../apps/api/src/services/fiscal-lookups";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { workspace } from "../support/workspace";

let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  department = "";
const request = (path: string, tenant?: string, session = cookie) =>
  app.inject({
    url: "/api/companies/" + (tenant ?? f.tenants[0]) + path,
    headers: { cookie: session },
  });

async function permissions(
  codes: string[],
  scope = "company",
  assigned = true,
) {
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and role_id in(select id from public.roles where tenant_id=$1 and code='billing')",
    [f.tenants[0]],
  );
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,p from public.roles cross join unnest($2::text[]) p where tenant_id=$1 and code='billing'",
    [f.tenants[0], codes],
  );
  await f.pool.query(
    "update public.memberships set scope=$3 where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId, scope],
  );
  await f.pool.query(
    "delete from public.membership_departments where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query("update public.departments set active=true where id=$1", [
    department,
  ]);
  if (assigned)
    await f.pool.query(
      "insert into public.membership_departments values($1,$2,$3)",
      [f.tenants[0], f.userId, department],
    );
  vi.mocked(FiscalLookups.prototype.cabys).mockClear();
  vi.mocked(FiscalLookups.prototype.recipient).mockClear();
}

beforeAll(async () => {
  f = await workspace({ role: "billing", companies: 2 });
  await f.pool.query(
    "update public.memberships set active=false where tenant_id=$1 and user_id=$2",
    [f.tenants[1], f.userId],
  );
  department = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas de prueba') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  vi.spyOn(FiscalLookups.prototype, "cabys").mockResolvedValue({
    available: true,
    source: "Hacienda",
    items: [],
  });
  vi.spyOn(FiscalLookups.prototype, "recipient").mockResolvedValue({
    available: true,
    source: "Hacienda",
    source_url: "https://api.hacienda.go.cr/fe/ae",
    recipient: { name: "Contribuyente de prueba", identification: "000000000" },
    activities: [
      {
        code: "4520.0",
        description: "Actividad de prueba",
        state: "A",
        active: true,
      },
    ],
  });
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
  const headers = { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf };
  const enroll = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers,
  });
  expect(enroll.statusCode, enroll.body).toBe(200);
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers,
    payload: {
      factorId: enroll.json().factorId,
      code: totp(enroll.json().secret),
    },
  });
  expect(verified.statusCode, verified.body).toBe(200);
  const session = await app.inject({
    url: "/api/auth/session",
    headers: { cookie },
  });
  expect(session.statusCode, session.body).toBe(200);
  expect(session.json().aal).toBe("aal2");
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
  vi.restoreAllMocks();
});

it("requires the relevant module permission before contacting a public lookup", async () => {
  await permissions(["catalog.read"]);
  expect((await request("/cabys?search=producto")).statusCode).toBe(200);
  expect(
    (await request("/recipient-lookup?identification=000000000")).statusCode,
  ).toBe(403);
  expect(FiscalLookups.prototype.recipient).not.toHaveBeenCalled();
  await permissions(["customers.read"]);
  expect((await request("/cabys?search=producto")).statusCode).toBe(403);
  const result = await request("/recipient-lookup?identification=000000000");
  expect(result.statusCode, result.body).toBe(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.json().activities[0].code).toBe("4520.0");
  expect(FiscalLookups.prototype.cabys).not.toHaveBeenCalled();
});

it.each(["invoices.read", "invoices.create", "invoices.edit"])(
  "allows %s only through an assigned active department",
  async (permission) => {
    // Department SELECT RLS admits organization.read or invoices.read. Keep
    // create/edit independent of invoices.read while permitting their metadata.
    const baseline =
      permission === "invoices.read" ? [] : ["organization.read"];
    await permissions([...baseline, permission], "departments");
    const recipient = await request(
      "/recipient-lookup?identification=000000000",
    );
    expect(recipient.statusCode, recipient.body).toBe(200);
    const cabys = await request("/cabys?search=producto");
    expect(cabys.statusCode, cabys.body).toBe(200);
    await f.pool.query(
      "update public.departments set active=false where id=$1",
      [department],
    );
    expect((await request("/locations")).statusCode).toBe(403);
    await permissions([...baseline, permission], "departments", false);
    expect(
      (await request("/recipient-lookup?identification=000000000")).statusCode,
    ).toBe(403);
    expect((await request("/cabys?search=producto")).statusCode).toBe(403);
    expect(FiscalLookups.prototype.recipient).not.toHaveBeenCalled();
    expect(FiscalLookups.prototype.cabys).not.toHaveBeenCalled();
    await permissions(["organization.read"], "departments");
    expect(
      (await request("/recipient-lookup?identification=000000000")).statusCode,
    ).toBe(403);
    expect((await request("/cabys?search=producto")).statusCode).toBe(403);
    expect(FiscalLookups.prototype.recipient).not.toHaveBeenCalled();
    expect(FiscalLookups.prototype.cabys).not.toHaveBeenCalled();
  },
);

it("denies missing sessions, inactive membership and other tenants before lookup", async () => {
  await permissions(["customers.read", "catalog.read"]);
  expect(
    (
      await request(
        "/recipient-lookup?identification=000000000",
        f.tenants[0],
        "",
      )
    ).statusCode,
  ).toBe(401);
  expect(
    (await request("/recipient-lookup?identification=000000000", f.tenants[1]))
      .statusCode,
  ).toBe(403);
  expect(
    (await request("/cabys?search=producto", randomUUID())).statusCode,
  ).toBe(403);
  expect(FiscalLookups.prototype.recipient).not.toHaveBeenCalled();
  expect(FiscalLookups.prototype.cabys).not.toHaveBeenCalled();
});

it("keeps issuer identity lookup behind the separate system administrator permission", async () => {
  await permissions(["customers.read", "catalog.read", "invoices.read"]);
  const url =
    "/api/company-administration/identity-lookup?identification=000000000";
  expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(403);
  expect(FiscalLookups.prototype.recipient).not.toHaveBeenCalled();
  await f.pool.query("insert into private.platform_operators values($1)", [
    f.userId,
  ]);
  const result = await app.inject({ url, headers: { cookie } });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.headers["cache-control"]).toBe("no-store");
});
