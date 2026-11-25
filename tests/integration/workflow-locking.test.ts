import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { createApp } from "../../apps/api/src/app";
let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  dep = "",
  customer = "";
const request = (
  path: string,
  payload: Record<string, unknown>,
  method = "POST",
) =>
  app.inject({
    method: method as any,
    url: "/api/companies/" + f.tenants[0] + path,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
beforeAll(async () => {
  f = await workspace({ role: "admin", systemAdmin: true });
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
  const e = await app.inject({
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
        payload: { factorId: e.json().factorId, code: totp(e.json().secret) },
      })
    ).statusCode,
  ).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
  dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Origen concurrente') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Cliente concurrente') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  expect((await request("/document-routes/setup", {})).statusCode).toBe(200);
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
async function draft() {
  return (
    await f.pool.query(
      `insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{"name":"Cliente concurrente"}',$4,$4,$5,'fixture') returning id`,
      [f.tenants[0], customer, dep, f.userId, randomUUID()],
    )
  ).rows[0].id as string;
}
async function concurrentEdit(
  id: string,
  start: () => ReturnType<typeof request>,
  projection: string,
) {
  const editor = await f.pool.connect();
  let editError: unknown;
  let pending: Promise<Awaited<ReturnType<typeof request>>> | undefined;
  try {
    await editor.query("begin");
    await editor.query("set local statement_timeout='5s'");
    await editor.query(
      "select id from public.invoice_drafts where id=$1 for update",
      [id],
    );
    const pid = (await editor.query("select pg_backend_pid() pid")).rows[0].pid;
    pending = start().then((r) => r);
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      waiting = !!(
        await f.pool.query(
          "select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query like $2",
          [pid, "%" + projection + "%"],
        )
      ).rowCount;
      if (waiting) break;
      await delay(5);
    }
    if (!waiting)
      throw Error("Workflow did not reach the expected source lock");
    // Existing editor order: draft lock, then audit FK takes tenant KEY SHARE.
    await editor.query(
      "update public.invoice_drafts set notes='Edición concurrente',version=version+1 where id=$1",
      [id],
    );
    await editor.query("commit");
  } catch (e) {
    editError = e;
    await editor.query("rollback");
  } finally {
    editor.release();
  }
  const response = await pending!;
  expect(editError).toBeUndefined();
  expect(response.statusCode, response.body).toBe(409);
}
it("does not deadlock an assignment with an existing draft edit", async () => {
  const id = await draft();
  await concurrentEdit(
    id,
    () =>
      request("/invoice-drafts/" + id + "/collection-review", {
        expected_version: 1,
      }),
    "private.assignment_source",
  );
});
it("does not deadlock a destination review with an existing draft edit", async () => {
  const id = await draft(),
    assigned = await request("/invoice-drafts/" + id + "/collection-review", {
      expected_version: 1,
    });
  expect(assigned.statusCode, assigned.body).toBe(200);
  await concurrentEdit(
    id,
    () =>
      request(
        "/document-work-items/" + assigned.json().id,
        {
          expected_version: 1,
          expected_source_version: 1,
          state: "in_review",
          assignee_id: null,
        },
        "PATCH",
      ),
    "private.work_source_version",
  );
});
