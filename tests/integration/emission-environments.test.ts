import { randomInt, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { EmissionWorkerStore } from "../../apps/api/src/services/emission-worker-store";
import { workspace } from "../support/workspace";

// Local persistence fixtures only. These do not represent an official response
// or a real transaction sent to either Hacienda environment.
let f: Awaited<ReturnType<typeof workspace>>;
let claims: Record<string, string>;
let department: string, draft: string, branch: string, terminal: string;
let testInvoice: any, productionInvoice: any;
const schemaHash =
  "b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e";

async function asActor<T>(fn: (db: pg.PoolClient) => Promise<T>) {
  const db = await f.pool.connect();
  try {
    await db.query("begin");
    await db.query("set local role conta_facil_api");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(claims),
    ]);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

async function createInvoice(environment: "test" | "production") {
  return (
    await f.pool.query(
      `insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,environment,snapshot,options,created_by,operation_id,request_hash,credential_version)
     values($1,$2,1,$3,$4,'{}','{"branch_code":"001","terminal_code":"00001"}',$5,$6,$7,1) returning *`,
      [
        f.tenants[0],
        draft,
        department,
        environment,
        f.userId,
        randomUUID(),
        "c".repeat(64),
      ],
    )
  ).rows[0];
}

async function lease(invoice: any, kind = "query") {
  return (
    await f.pool.query(
      `insert into private.emission_jobs(tenant_id,invoice_id,kind,status,lease_token,lease_until)
     values($1,$2,$3,'leased',gen_random_uuid(),now()+interval '2 minutes')
     on conflict(tenant_id,invoice_id,kind) do update set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' returning *`,
      [invoice.tenant_id, invoice.id, kind],
    )
  ).rows[0];
}

function evidence(invoice: any, hash: string, status = "accepted") {
  return {
    method: "official_api",
    tenantId: invoice.tenant_id,
    environment: invoice.environment,
    credentialVersion: invoice.credential_version,
    clave: invoice.clave,
    responseSha256: hash,
    rawJsonSha256: "d".repeat(64),
    observedAt: new Date().toISOString(),
    endpoint: `https://api.comprobanteselectronicos.go.cr/${invoice.environment === "test" ? "recepcion-sandbox" : "recepcion"}/v1/recepcion/${invoice.clave}`,
    synthetic: false,
    profile: invoice.environment,
    httpStatus: 200,
    policyVersion: "official-api-v1",
    responseSchemaSha256: schemaHash,
    certificateFingerprint: "e".repeat(64),
    verification: "xml_signature_and_correlation",
    haciendaStatus: status,
  };
}

beforeAll(async () => {
  f = await workspace({ role: "admin", systemAdmin: true, companies: 2 });
  const sessionId = randomUUID(),
    tenant = f.tenants[0];
  claims = { sub: f.userId, session_id: sessionId, aal: "aal2" };
  await f.pool.query(
    "insert into private.sessions(id,user_id,auth_session_id,encrypted_tokens,csrf_hash,expires_at) values($1,$2,$3,'TEST','TEST',now()+interval '1 hour')",
    [randomUUID(), f.userId, sessionId],
  );
  await f.pool.query(
    "update public.tenants set identification_type='02',identification=$2 where id=$1",
    [tenant, String(randomInt(1000000000, 9999999999))],
  );
  department = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Environment persistence TEST') returning id",
      [tenant],
    )
  ).rows[0].id;
  const customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Environment persistence TEST') returning id",
      [tenant],
    )
  ).rows[0].id;
  draft = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{}',$4,$4,$5,'TEST') returning id",
      [tenant, customer, department, f.userId, randomUUID()],
    )
  ).rows[0].id;
  branch = (
    await f.pool.query(
      "insert into public.branches(tenant_id,name,code) values($1,'TEST','001') returning id",
      [tenant],
    )
  ).rows[0].id;
  terminal = (
    await f.pool.query(
      "insert into public.terminals(tenant_id,branch_id,name,code) values($1,$2,'TEST','00001') returning id",
      [tenant, branch],
    )
  ).rows[0].id;
  for (const environment of ["test", "production"]) {
    const fingerprint = (environment === "test" ? "a" : "b").repeat(64);
    await f.pool.query(
      "insert into public.hacienda_configuration(tenant_id,environment,certificate_metadata,api_status) values($1,$2,$3,'success')",
      [
        tenant,
        environment,
        {
          fingerprint,
          technical_status: "valid_local",
          valid_from: "2020-01-01T00:00:00Z",
          valid_until: "2099-01-01T00:00:00Z",
        },
      ],
    );
    await f.pool.query(
      "insert into private.hacienda_credential_versions(tenant_id,environment,version,api_key_id,api_ciphertext,pkcs12_key_id,pkcs12_ciphertext,created_by) values($1,$2,1,'TEST',$3,'TEST',$3,$4)",
      [tenant, environment, Buffer.alloc(28), f.userId],
    );
    await f.pool.query(
      "update public.hacienda_configuration set active_version=1 where tenant_id=$1 and environment=$2",
      [tenant, environment],
    );
    await asActor((db) =>
      db.query(
        `insert into private.hacienda_credential_enrollments(tenant_id,environment,version,issuer_identification,issuer_identification_type,certificate_fingerprint,confirmed_by,evidence_reference)
       select id,$2,1,identification,identification_type,$3,$4,'Local administrative review TEST' from public.tenants where id=$1`,
        [tenant, environment, fingerprint, f.userId],
      ),
    );
  }
  testInvoice = await createInvoice("test");
  productionInvoice = await createInvoice("production");
});

afterAll(async () => {
  await f?.pool.end();
});

it("keeps one prepared invoice per tenant, draft and environment", async () => {
  expect(testInvoice.environment).toBe("test");
  expect(productionInvoice.environment).toBe("production");
  expect(testInvoice.draft_id).toBe(productionInvoice.draft_id);
  await expect(createInvoice("test")).rejects.toThrow("unique");
  await expect(createInvoice("production")).rejects.toThrow("unique");
});

it("returns only the current matching enrollment without requiring Hacienda read permission", async () => {
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission='hacienda.read'",
    [f.tenants[0]],
  );
  const metadata = (tenant = f.tenants[0], invoice = productionInvoice.id) =>
    asActor(
      async (db) =>
        (
          await db.query("select private.invoice_emission_metadata($1,$2) m", [
            tenant,
            invoice,
          ])
        ).rows[0].m,
    );
  const result = await metadata();
  expect(result.company.identification_type).toBe("02");
  expect(result.enrollment).toMatchObject({
    environment: "production",
    version: 1,
    status: "operator_verified",
    certificate_fingerprint: "b".repeat(64),
  });
  expect(await metadata(f.tenants[1])).toBeNull();
  await f.pool.query(
    "update public.hacienda_configuration set certificate_metadata='{}' where tenant_id=$1 and environment='production'",
    [f.tenants[0]],
  );
  expect((await metadata()).enrollment).toBeNull();
  await f.pool.query(
    "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1 and environment='production'",
    [f.tenants[0], { fingerprint: "b".repeat(64) }],
  );
  await f.pool.query(
    "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1 and environment='production'",
    [f.tenants[0], { fingerprint: "BB:".repeat(31) + "BB" }],
  );
  expect((await metadata()).enrollment).toMatchObject({
    certificate_fingerprint: "b".repeat(64),
  });
  const oldIdentity = result.company.identification;
  await f.pool.query(
    "update public.tenants set identification=$2 where id=$1",
    [f.tenants[0], String(randomInt(1000000000, 9999999999))],
  );
  expect((await metadata()).enrollment).toBeNull();
  await f.pool.query(
    "update public.tenants set identification=$2 where id=$1",
    [f.tenants[0], oldIdentity],
  );
  await f.pool.query(
    "update public.hacienda_configuration set active_version=null where tenant_id=$1 and environment='production'",
    [f.tenants[0]],
  );
  expect((await metadata()).enrollment).toBeNull();
  await f.pool.query(
    "update public.hacienda_configuration set active_version=1 where tenant_id=$1 and environment='production'",
    [f.tenants[0]],
  );
});

it("confirms independent sequence floors and preserves the historical counter", async () => {
  await f.pool.query(
    "insert into public.document_sequences(tenant_id,branch_id,terminal_id,document_type,last_value) values($1,$2,$3,'FE',40)",
    [f.tenants[0], branch, terminal],
  );
  await asActor((db) =>
    db.query("select private.confirm_emission_numbering($1,'001','00001',50)", [
      f.tenants[0],
    ]),
  );
  await asActor((db) =>
    db.query(
      "select private.confirm_emission_numbering($1,'001','00001',75,'production')",
      [f.tenants[0]],
    ),
  );
  expect(
    (
      await f.pool.query(
        "select environment,last_value,legacy_floor from private.emission_sequences where tenant_id=$1 order by environment",
        [f.tenants[0]],
      )
    ).rows,
  ).toEqual([
    { environment: "production", last_value: "75", legacy_floor: "40" },
    { environment: "test", last_value: "50", legacy_floor: "40" },
  ]);
  await expect(
    asActor((db) =>
      db.query(
        "select private.confirm_emission_numbering($1,'001','00001',39,'production')",
        [f.tenants[0]],
      ),
    ),
  ).rejects.toThrow("LEGACY_SEQUENCE_FLOOR");
  await expect(
    asActor((db) =>
      db.query(
        "select private.confirm_emission_numbering($1,'001','00001',60,'production')",
        [f.tenants[0]],
      ),
    ),
  ).rejects.toThrow("SEQUENCE_CANNOT_DECREASE");
  expect(
    (
      await f.pool.query(
        "select last_value from public.document_sequences where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows[0].last_value,
  ).toBe("40");
  claims.aal = "aal1";
  try {
    await expect(
      asActor((db) =>
        db.query(
          "select private.confirm_emission_numbering($1,'001','00001',90,'production')",
          [f.tenants[0]],
        ),
      ),
    ).rejects.toThrow("FORBIDDEN");
  } finally {
    claims.aal = "aal2";
  }
});

it("derives and freezes the job environment without an interactive JWT", async () => {
  const job = await asActor(async (db) => {
    await db.query("select set_config('request.jwt.claims','{}',true)");
    return (
      await db.query(
        "insert into private.emission_jobs(tenant_id,invoice_id,kind,environment) values($1,$2,'pdf','test') returning *",
        [f.tenants[0], productionInvoice.id],
      )
    ).rows[0];
  });
  expect(job.environment).toBe("production");
  for (const patch of [
    "environment='test'",
    `invoice_id='${testInvoice.id}'`,
    "kind='sign'",
  ]) {
    await expect(
      f.pool.query(`update private.emission_jobs set ${patch} where id=$1`, [
        job.id,
      ]),
    ).rejects.toThrow("EMISSION_JOB_BINDING_IMMUTABLE");
  }
});

it("reads only the credential environment pinned by the leased document", async () => {
  const store = new EmissionWorkerStore(f.pool);
  const testJob = await lease(testInvoice, "sign");
  const productionJob = await lease(productionInvoice, "sign");
  expect(await store.credentials(testJob)).toMatchObject({
    tenant_id: f.tenants[0],
    environment: "test",
    version: 1,
  });
  expect(await store.credentials(productionJob)).toMatchObject({
    tenant_id: f.tenants[0],
    environment: "production",
    version: 1,
  });
  expect(
    await store.credentials({ ...productionJob, environment: "test" }),
  ).toMatchObject({
    environment: "production",
    version: 1,
  });
});

it("protects issued document identity and the pinned response policy", async () => {
  productionInvoice = (
    await f.pool.query(
      "update public.electronic_invoices set document_status='issued',signature_status='signed',transmission_status='sent',clave=$2,response_trust_policy='official_api' where id=$1 returning *",
      [productionInvoice.id, "8".repeat(50)],
    )
  ).rows[0];
  for (const patch of [
    "environment='test'",
    "document_type='TE'",
    `draft_id='${randomUUID()}'`,
    "response_trust_policy='pinned_certificate'",
  ]) {
    await expect(
      f.pool.query(
        `update public.electronic_invoices set ${patch} where id=$1`,
        [productionInvoice.id],
      ),
    ).rejects.toThrow("ISSUED_INVOICE_IMMUTABLE");
  }
});

it("persists response observations only through a live query capability and rejects cross-environment evidence", async () => {
  const query = await lease(productionInvoice),
    pdf = await lease(productionInvoice, "pdf");
  const hash = "9".repeat(64),
    observation = evidence(productionInvoice, hash);
  const observe = (job = query, input = observation, sha = hash) =>
    asActor(
      async (db) =>
        (
          await db.query(
            "select private.emission_job_observe_response($1,$2,$3,$4) id",
            [job.id, job.lease_token, sha, input],
          )
        ).rows[0].id,
    );
  await f.pool.query(
    "insert into private.invoice_artifacts(tenant_id,invoice_id,kind,content,sha256) values($1,$2,'hacienda_response',$3,$4)",
    [
      f.tenants[0],
      productionInvoice.id,
      Buffer.from("<response TEST='true'/>"),
      hash,
    ],
  );
  await expect(
    new EmissionWorkerStore(f.pool).update(query, {
      hacienda_status: "accepted",
    }),
  ).rejects.toThrow("HACIENDA_RESPONSE_OBSERVATION_REQUIRED");
  await expect(observe(pdf)).rejects.toThrow("INVALID_OBSERVATION_JOB");
  expect(await observe({ ...query, lease_token: randomUUID() })).toBeNull();
  for (const patch of [
    { environment: "test" },
    { tenantId: f.tenants[1] },
    { credentialVersion: 2 },
    { responseSha256: "1".repeat(64) },
    { method: "pinned_certificate" },
    { verification: null },
    { synthetic: true },
    { rawJsonSha256: "invalid" },
    { endpoint: "https://example.test/response" },
    { observedAt: "invalid" },
    { notes: "x".repeat(32769) },
  ]) {
    await expect(
      observe(query, { ...observation, ...patch } as any),
    ).rejects.toThrow("INVALID_RESPONSE_OBSERVATION");
  }
  const id = await observe();
  expect(id).toBeTruthy();
  expect(await observe()).toBe(id);
  const row = (
    await f.pool.query(
      "select * from private.invoice_response_observations where id=$1",
      [id],
    )
  ).rows[0];
  expect(row).toMatchObject({
    tenant_id: f.tenants[0],
    invoice_id: productionInvoice.id,
    environment: "production",
    credential_version: 1,
    response_sha256: hash,
  });
  await expect(
    f.pool.query(
      "update private.invoice_response_observations set evidence='{}' where id=$1",
      [id],
    ),
  ).rejects.toThrow("RESPONSE_OBSERVATION_IMMUTABLE");
  await expect(
    f.pool.query(
      "delete from private.invoice_response_observations where id=$1",
      [id],
    ),
  ).rejects.toThrow("RESPONSE_OBSERVATION_IMMUTABLE");
  await f.pool.query(
    "update private.emission_jobs set lease_until=now()-interval '1 second' where id=$1",
    [query.id],
  );
  expect(await observe()).toBeNull();
});

it("requires a matching verified observation for final official-api states", async () => {
  const store = new EmissionWorkerStore(f.pool),
    query = await lease(productionInvoice);
  await expect(
    store.update(query, { hacienda_status: "rejected" }),
  ).rejects.toThrow("HACIENDA_RESPONSE_OBSERVATION_REQUIRED");
  expect(
    (await store.update(query, { hacienda_status: "accepted" }))
      .hacienda_status,
  ).toBe("accepted");
});

it("exposes neither observations nor the capability function to public client roles", async () => {
  const privileges = (
    await f.pool.query(
      `select has_table_privilege('authenticated','private.invoice_response_observations','SELECT') client_read,
      has_table_privilege('anon','private.invoice_response_observations','INSERT') anon_write,
      has_table_privilege('conta_facil_api','private.invoice_response_observations','INSERT') runtime_direct_write,
      has_function_privilege('authenticated','private.emission_job_observe_response(uuid,uuid,text,jsonb)','EXECUTE') client_execute,
      has_function_privilege('conta_facil_api','private.emission_job_observe_response(uuid,uuid,text,jsonb)','EXECUTE') runtime_execute,
      (select relrowsecurity from pg_class where oid='private.invoice_response_observations'::regclass) rls`,
    )
  ).rows[0];
  expect(privileges).toEqual({
    client_read: false,
    anon_write: false,
    runtime_direct_write: false,
    client_execute: false,
    runtime_execute: true,
    rls: true,
  });
});
