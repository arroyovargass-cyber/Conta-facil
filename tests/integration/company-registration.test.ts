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
  created: any;
const request = (url: string, method = "GET", payload?: any) =>
  app.inject({
    url: "/api" + url,
    method: method as any,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
const payload = () => ({
  operation_id: randomUUID(),
  legal_name: "Nueva empresa local",
  person_type: "legal",
  identification_type: "02",
  identification: "3101" + String(Date.now()).slice(-6),
});
beforeAll(async () => {
  f = await workspace({ role: "admin", companies: 2 });
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
  const enroll = await request("/auth/mfa/enroll", "POST", {});
  expect(
    (
      await request("/auth/mfa/verify", "POST", {
        factorId: enroll.json().factorId,
        code: totp(enroll.json().secret),
      })
    ).statusCode,
  ).toBe(200);
  csrf = (await request("/auth/session")).json().csrf;
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
it("denies conventional administrator access to company creation and user administration", async () => {
  expect((await request("/company-administration")).json().canManage).toBe(
    false,
  );
  expect(
    (await request("/company-administration", "POST", payload())).statusCode,
  ).toBe(403);
  const update = await request("/companies/" + f.tenants[0], "PATCH", {
    legal_name: "Intrusión",
    trade_name: "",
    identification_type: "other",
    identification: "old",
    contact_email: "",
    phone: "",
    address: "",
  });
  expect(update.statusCode).toBe(403);
  const roles = await f.pool.query(
    "select id from public.roles where tenant_id=$1 and code='auditor'",
    [f.tenants[0]],
  );
  expect(
    (
      await request("/companies/" + f.tenants[0] + "/invitations", "POST", {
        email: "blocked@example.test",
        role_id: roles.rows[0].id,
        scope: "company",
      })
    ).statusCode,
  ).toBe(403);
});
it("creates once, associates the owner, detects duplicate identification and reopens", async () => {
  await f.pool.query("insert into private.platform_operators values($1)", [
    f.userId,
  ]);
  const p = payload();
  const [a, b] = await Promise.all([
    request("/company-administration", "POST", p),
    request("/company-administration", "POST", p),
  ]);
  expect(a.statusCode, a.body).toBe(200);
  expect(b.statusCode, b.body).toBe(200);
  expect(a.json().item.id).toBe(b.json().item.id);
  created = a.json().item;
  const c = await request("/company-administration/" + created.id);
  expect(c.json().item.legal_name).toBe(p.legal_name);
  expect(
    (await request("/companies/" + created.id + "/overview")).json()
      .permissions,
  ).toContain("company.manage");
  expect(
    (
      await request("/company-administration", "POST", {
        ...p,
        operation_id: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("/company-administration", "POST", {
        ...p,
        legal_name: "Altered",
      })
    ).statusCode,
  ).toBe(409);
});
it("persists independent parameters and activities, rejects stale edits and retains inactive company management", async () => {
  const value = {
    ...created,
    legal_name: "Editada",
    configuration: {
      ...created.configuration,
      accounting: { ...created.configuration.accounting, banks: true },
    },
    activities: [
      { code: "123456", name: "Declarada manualmente", primary: true },
    ],
  };
  delete value.id;
  delete value.created_at;
  delete value.updated_at;
  delete value.created_by;
  delete value.updated_by;
  delete value.configuration_version;
  delete value.preparation;
  const p = { ...value, expected_version: created.configuration_version };
  const saved = await request(
    "/company-administration/" + created.id,
    "PATCH",
    p,
  );
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().item.configuration.accounting.banks).toBe(true);
  expect(saved.json().item.activities[0].primary).toBe(true);
  expect(
    (await request("/company-administration/" + created.id, "PATCH", p))
      .statusCode,
  ).toBe(409);
  const deactivated = await request(
    "/company-administration/" + created.id,
    "PATCH",
    {
      ...p,
      expected_version: saved.json().item.configuration_version,
      active: false,
    },
  );
  expect(deactivated.statusCode, deactivated.body).toBe(200);
  expect(
    (await request("/company-administration"))
      .json()
      .items.some((r: any) => r.id === created.id && !r.active),
  ).toBe(true);
  expect(
    (await request("/companies"))
      .json()
      .items.some((r: any) => r.id === created.id),
  ).toBe(false);
  expect(
    (
      await request("/company-administration/" + created.id, "PATCH", {
        ...p,
        expected_version: deactivated.json().item.configuration_version,
        active: true,
      })
    ).statusCode,
  ).toBe(200);
});
it("rejects unrelated company even for operator and rejects secrets in configuration", async () => {
  const foreign = (
    await f.pool.query(
      "insert into public.tenants(legal_name,identification_type,identification) values('Ajena','other',$1) returning id",
      [randomUUID()],
    )
  ).rows[0].id;
  expect((await request("/company-administration/" + foreign)).statusCode).toBe(
    404,
  );
  expect(
    (
      await request("/company-administration", "POST", {
        ...payload(),
        configuration: { password: "never store" },
      })
    ).statusCode,
  ).toBe(400);
});
it("retains consecutive counters and rejects malformed location and logo", async () => {
  await f.pool.query(
    "insert into private.platform_operators values($1) on conflict do nothing",
    [f.userId],
  );
  const p = {
    ...payload(),
    configuration: {
      billing: {
        branch_code: "001",
        terminal_code: "00001",
        documents: ["FE", "TE"],
      },
    },
  };
  const made = await request("/company-administration", "POST", p);
  expect(made.statusCode, made.body).toBe(200);
  const item = made.json().item;
  await f.pool.query(
    "update public.document_sequences set last_value=7 where tenant_id=$1 and document_type='FE'",
    [item.id],
  );
  const input = Object.fromEntries(
    [
      "legal_name",
      "trade_name",
      "person_type",
      "identification_type",
      "identification",
      "contact_email",
      "phone",
      "address",
      "active",
      "configuration",
      "activities",
    ].map((k) => [k, item[k]]),
  );
  const saved = await request("/company-administration/" + item.id, "PATCH", {
    ...input,
    expected_version: item.configuration_version,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const reopened = await request("/company-administration/" + item.id);
  expect(
    reopened.json().sequences.find((r: any) => r.document_type === "FE")
      .last_value,
  ).toBe("7");
  expect(
    (
      await request("/company-administration", "POST", {
        ...payload(),
        configuration: {
          location: { province: "1", canton: "99", district: "99" },
        },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request("/company-administration", "POST", {
        ...payload(),
        configuration: { logo: "data:image/png;base64,QUJD" },
      })
    ).statusCode,
  ).toBe(400);
  const db = await f.pool.connect();
  try {
    await db.query("begin");
    const session = await db.query(
      "select auth_session_id from private.sessions where user_id=$1 limit 1",
      [f.userId],
    );
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: f.userId,
        aal: "aal1",
        session_id: session.rows[0].auth_session_id,
      }),
    ]);
    await db.query("set local role authenticated");
    expect(
      (await db.query("select private.is_system_administrator() allowed"))
        .rows[0].allowed,
    ).toBe(false);
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("preserves legacy activities while completing unrelated company fields", async () => {
  await f.pool.query(
    "insert into public.economic_activities(tenant_id,code,name,source_url) values($1,'legacy-1','Actividad histórica','https://example.test/reference')",
    [f.tenants[0]],
  );
  const opened = await request("/company-administration/" + f.tenants[0]);
  expect(opened.statusCode, opened.body).toBe(200);
  const input = Object.fromEntries(
    [
      "legal_name",
      "trade_name",
      "person_type",
      "identification_type",
      "identification",
      "contact_email",
      "phone",
      "address",
      "active",
      "configuration",
      "activities",
    ].map((k) => [k, opened.json().item[k]]),
  );
  const saved = await request(
    "/company-administration/" + f.tenants[0],
    "PATCH",
    {
      ...input,
      phone: "22223333",
      expected_version: opened.json().item.configuration_version,
    },
  );
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().item.activities[0].code).toBe("legacy-1");
});
it("checks direct RLS permission after operator revocation", async () => {
  await f.pool.query(
    "delete from private.platform_operators where user_id=$1",
    [f.userId],
  );
  const db = await f.pool.connect();
  try {
    await db.query("begin");
    const s = await f.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 order by expires_at desc limit 1",
      [f.userId],
    );
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: f.userId,
        aal: "aal2",
        session_id: s.rows[0].auth_session_id,
      }),
    ]);
    await db.query("set local role authenticated");
    expect(
      (
        await db.query(
          "select private.has_access($1,'company.manage') allowed",
          [f.tenants[0]],
        )
      ).rows[0].allowed,
    ).toBe(false);
    expect(
      (
        await db.query(
          "update public.tenants set legal_name='Forbidden' where id=$1 returning id",
          [f.tenants[0]],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await db.query("rollback");
    db.release();
  }
});
