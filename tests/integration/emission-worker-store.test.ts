import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { EmissionWorkerStore } from "../../apps/api/src/services/emission-worker-store";
import type { Job, JobKind } from "../../apps/api/src/services/emission-jobs";
let f: Awaited<ReturnType<typeof workspace>>,
  store: EmissionWorkerStore,
  invoice: string;
beforeAll(async () => {
  f = await workspace({ role: "operative", companies: 2 });
  store = new EmissionWorkerStore(f.pool);
  const t = f.tenants[0];
  await f.pool.query(
    "insert into public.role_permissions(tenant_id,role_id,permission) select tenant_id,id,'invoices.emit' from public.roles where tenant_id=$1 and code='operative'",
    [t],
  );
  const dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Worker') returning id",
      [t],
    )
  ).rows[0].id;
  const customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Worker') returning id",
      [t],
    )
  ).rows[0].id;
  const draft = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{}',$4,$4,$5,'worker') returning id",
      [t, customer, dep, f.userId, randomUUID()],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.hacienda_configuration(tenant_id) values($1)",
    [t],
  );
  await f.pool.query(
    "insert into private.hacienda_credential_versions(tenant_id,environment,version,api_key_id,api_ciphertext,pkcs12_key_id,pkcs12_ciphertext,created_by) values($1,'test',1,'test',$2,'test',$2,$3)",
    [t, Buffer.alloc(28), f.userId],
  );
  invoice = (
    await f.pool.query(
      "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash,credential_version) values($1,$2,1,$3,'{}','{}',$4,$5,$6,1) returning id",
      [t, draft, dep, f.userId, randomUUID(), "a".repeat(64)],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await f?.pool.query("delete from private.emission_jobs where invoice_id=$1", [
    invoice,
  ]);
  await f?.pool.end();
});
async function job(kind: JobKind): Promise<Job> {
  return (
    await f.pool.query(
      "insert into private.emission_jobs(tenant_id,invoice_id,kind,status,lease_token,lease_until) values($1,$2,$3,'leased',gen_random_uuid(),now()+interval '2 minutes') on conflict(tenant_id,invoice_id,kind) do update set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' returning *",
      [f.tenants[0], invoice, kind],
    )
  ).rows[0];
}
it("reads only a live lease capability without a JWT, including runtime role", async () => {
  const j = await job("sign");
  expect((await store.document(j)).id).toBe(invoice);
  expect(await store.document({ ...j, lease_token: randomUUID() })).toBeNull();
  expect(await store.document({ ...j, id: randomUUID() })).toBeNull();
  const db = await f.pool.connect();
  try {
    await db.query("begin");
    await db.query("set local role conta_facil_api");
    expect(
      (
        await db.query("select * from private.emission_job_document($1,$2)", [
          j.id,
          j.lease_token,
        ])
      ).rows[0].id,
    ).toBe(invoice);
    expect(
      (
        await db.query(
          "select has_function_privilege('authenticated','private.emission_job_document(uuid,uuid)','EXECUTE') allowed,has_table_privilege('authenticated','private.invoice_artifacts','SELECT') artifacts",
        )
      ).rows[0],
    ).toEqual({ allowed: false, artifacts: false });
  } finally {
    await db.query("rollback");
    db.release();
  }
  await expect(
    f.pool.query(
      "insert into private.emission_jobs(tenant_id,invoice_id,kind) values($1,$2,'pdf')",
      [f.tenants[1], invoice],
    ),
  ).rejects.toThrow();
  await f.pool.query(
    "update private.emission_jobs set lease_until=now()-interval '1 second' where id=$1",
    [j.id],
  );
  expect(await store.document(j)).toBeNull();
  expect(await store.credentials(j)).toBeNull();
  expect(await store.update(j, { signature_status: "signed" })).toBeNull();
});
it("rechecks actor revocation while allowing sent response recovery", async () => {
  const sign = await job("sign"),
    query = await job("query");
  await f.pool.query("update public.profiles set active=false where id=$1", [
    f.userId,
  ]);
  expect(await store.document(sign)).toBeNull();
  expect(await store.credentials(sign)).toBeNull();
  expect(await store.document(query)).toBeNull();
  await f.pool.query(
    "update public.electronic_invoices set transmission_status='sent' where id=$1",
    [invoice],
  );
  expect((await store.document(query)).id).toBe(invoice);
  expect((await store.credentials(query)).version).toBe(1);
  await f.pool.query("update public.profiles set active=true where id=$1", [
    f.userId,
  ]);
});
it("pins credentials and blocks inactive versions for signing but allows recovery", async () => {
  const sign = await job("sign"),
    query = await job("query");
  expect((await store.credentials(sign)).version).toBe(1);
  await f.pool.query(
    "update private.hacienda_credential_versions set active=false where tenant_id=$1",
    [f.tenants[0]],
  );
  expect(await store.credentials(sign)).toBeNull();
  expect((await store.credentials(query)).version).toBe(1);
  expect(await store.credentials(await job("pdf"))).toBeNull();
});
it("limits fenced patches by job kind and requires response evidence", async () => {
  await f.pool.query(
    "update public.electronic_invoices set transmission_status='not_sent' where id=$1",
    [invoice],
  );
  const sign = await job("sign");
  await expect(store.update(sign, { snapshot: {} })).rejects.toThrow(
    "INVALID_WORKER_PATCH",
  );
  await expect(
    store.update(sign, { transmission_status: "sent" }),
  ).rejects.toThrow("INVALID_WORKER_PATCH");
  await expect(
    store.update(sign, { hacienda_status: "accepted" }),
  ).rejects.toThrow("INVALID_WORKER_PATCH");
  expect(
    (
      await store.update(sign, {
        signature_status: "signed",
        transmission_status: "queued",
      })
    ).signature_status,
  ).toBe("signed");
  const query = await job("query");
  // A queued document is not eligible for a response query. Once sent, the
  // existing evidence fence must still reject an unproved final status.
  expect(await store.update(query, { hacienda_status: "accepted" })).toBeNull();
  await f.pool.query(
    "update public.electronic_invoices set transmission_status='sent' where id=$1",
    [invoice],
  );
  await expect(
    store.update(query, { hacienda_status: "accepted" }),
  ).rejects.toThrow("HACIENDA_RESPONSE_REQUIRED");
  await f.pool.query(
    "insert into private.invoice_artifacts(tenant_id,invoice_id,kind,content,sha256) values($1,$2,'hacienda_response',$3,$4)",
    [f.tenants[0], invoice, Buffer.from("<response/>"), "b".repeat(64)],
  );
  expect(
    (await store.update(query, { hacienda_status: "accepted" }))
      .hacienda_status,
  ).toBe("accepted");
  await expect(
    store.update(query, { hacienda_status: "pending" }),
  ).rejects.toThrow("INVALID_WORKER_TRANSITION");
  await expect(
    store.update(query, { hacienda_status: "rejected" }),
  ).rejects.toThrow("INVALID_WORKER_TRANSITION");
  const transmit = await job("transmit");
  await expect(
    store.update(transmit, { transmission_status: "sent" }),
  ).rejects.toThrow("INVALID_WORKER_TRANSITION");
  await f.pool.query(
    "update public.electronic_invoices set transmission_status='sent' where id=$1",
    [invoice],
  );
  await expect(
    store.update(sign, { public_certificate_pem: "replacement" }),
  ).rejects.toThrow("INVALID_WORKER_TRANSITION");
});
it("honors the global issuer and enforces membership and department scope after its platform role is revoked", async () => {
  await f.pool.query(
    "update public.electronic_invoices set transmission_status='not_sent' where id=$1",
    [invoice],
  );
  const sign = await job("sign");
  await f.pool.query(
    "insert into private.platform_operators(user_id) values($1)",
    [f.userId],
  );
  await f.pool.query(
    "update public.memberships set active=false where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  expect((await store.document(sign)).id).toBe(invoice);
  await f.pool.query(
    "delete from private.platform_operators where user_id=$1",
    [f.userId],
  );
  expect(await store.document(sign)).toBeNull();
  await f.pool.query(
    "update public.memberships set active=true,scope='departments' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  expect(await store.document(sign)).toBeNull();
  await f.pool.query(
    "insert into public.membership_departments(tenant_id,user_id,department_id) select tenant_id,$2,department_id from public.electronic_invoices where id=$1",
    [invoice, f.userId],
  );
  expect((await store.document(sign)).id).toBe(invoice);
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission='invoices.emit'",
    [f.tenants[0]],
  );
  expect(await store.document(sign)).toBeNull();
});
