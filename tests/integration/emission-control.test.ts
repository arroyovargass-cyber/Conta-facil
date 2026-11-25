import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID, randomInt } from "node:crypto";
import { workspace } from "../support/workspace";
import {
  emissionReadiness,
  issuePreparedInvoice,
} from "../../apps/api/src/services/emission-control";
import {
  receiverInput,
  lineFiscalInput,
} from "../../packages/domain/src/invoice-fiscal";
import {
  emissionOptionsInput,
  prepareEmission,
} from "../../packages/domain/src/emission";
import type pg from "pg";
let f: Awaited<ReturnType<typeof workspace>>,
  row: any,
  claims: any,
  config: any;
const certificate = {
  technical_status: "valid_local",
  identity_status: "verified",
  fingerprint: "a".repeat(64),
  valid_from: "2020-01-01",
  valid_until: "2099-01-01",
  fixture:
    "TEST ONLY: synthetic verified metadata; no actual certificate or identity attestation",
};
async function run<T>(fn: (db: pg.PoolClient) => Promise<T>) {
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
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}
beforeAll(async () => {
  f = await workspace({ role: "admin", systemAdmin: true, companies: 2 });
  const t = f.tenants[0];
  const preparer = await workspace();
  const preparerId = preparer.userId;
  await preparer.pool.end();
  const sid = randomUUID();
  claims = { sub: f.userId, session_id: sid, aal: "aal2" };
  await f.pool.query(
    "insert into private.sessions(id,user_id,auth_session_id,encrypted_tokens,csrf_hash,expires_at) values($1,$2,$3,'TEST','TEST',now()+interval '1 hour')",
    [randomUUID(), f.userId, sid],
  );
  const issuer = (
    await f.pool.query(
      "update public.tenants set identification=$2,identification_type='02',contact_email='emisor@example.test',address='Dirección TEST',configuration=jsonb_build_object('location',jsonb_build_object('province','1','canton','01','district','01')) where id=$1 returning *",
      [t, String(randomInt(1000000000, 9999999999))],
    )
  ).rows[0];
  const dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Issuance TEST') returning id",
      [t],
    )
  ).rows[0].id;
  const b = (
    await f.pool.query(
      "insert into public.branches(tenant_id,name,code) values($1,'TEST','001') returning id",
      [t],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.terminals(tenant_id,branch_id,name,code) values($1,$2,'TEST','00001')",
    [t, b],
  );
  await f.pool.query(
    "insert into public.economic_activities(tenant_id,code,name,source_url) values($1,'123456','TEST','https://example.test')",
    [t],
  );
  const customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'TEST') returning id",
      [t],
    )
  ).rows[0].id;
  const draft = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{}',$4,$4,$5,'TEST') returning id",
      [t, customer, dep, f.userId, randomUUID()],
    )
  ).rows[0].id;
  const lines = [
    {
      description: "TEST",
      quantity: "1",
      unit_price: "100",
      fiscal: lineFiscalInput.parse({
        cabys: "0000000000001",
        unit: "Unid",
        treatment: "taxable",
        tariff_code: "08",
      }),
    },
  ];
  const receiver = receiverInput.parse({
    name: "TEST",
    identification_type: "01",
    identification: "123456789",
    domicile: "domestic",
    province: "1",
    canton: "01",
    district: "01",
    address: "Dirección TEST",
    email: "test@example.test",
  });
  const options = emissionOptionsInput.parse({
    branch_code: "001",
    terminal_code: "00001",
    issuer_activity: "123456",
    payment_methods: [{ code: "01", amount: "113" }],
  });
  const snapshot = {
    issuer,
    receiver,
    lines,
    currency: "CRC",
    preparation_issues: [],
    totals: prepareEmission({
      document_type: "FE",
      currency: "CRC",
      receiver,
      lines,
      options,
    }).totals,
  };
  row = (
    await f.pool.query(
      "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash) values($1,$2,1,$3,$4,$5,$6,$7,$8) returning *",
      [
        t,
        draft,
        dep,
        snapshot,
        options,
        f.userId,
        randomUUID(),
        "b".repeat(64),
      ],
    )
  ).rows[0];
  await f.pool.query(
    "update public.electronic_invoices set created_by=$2 where id=$1",
    [row.id, preparerId],
  );
  await f.pool.query(
    "insert into public.hacienda_configuration(tenant_id,certificate_metadata,api_status) values($1,$2,'success')",
    [t, certificate],
  );
  await f.pool.query(
    "insert into private.hacienda_credential_versions(tenant_id,environment,version,api_key_id,api_ciphertext,pkcs12_key_id,pkcs12_ciphertext,created_by) values($1,'test',1,'TEST',$2,'TEST',$2,$3)",
    [t, Buffer.alloc(28), f.userId],
  );
  await f.pool.query(
    "update public.hacienda_configuration set active_version=1 where tenant_id=$1",
    [t],
  );
  config = {
    ...f.config,
    HACIENDA_STAG_EMISSION_ENABLED: "true",
    HACIENDA_KEYRING: JSON.stringify({ TEST: "c".repeat(64) }),
    HACIENDA_ACTIVE_KEY_ID: "TEST",
    HACIENDA_SOFTWARE_PROVIDER_ID: "3101123456",
    HACIENDA_RESPONSE_CERTIFICATE_PINS: JSON.stringify(["d".repeat(64)]),
  };
  await run((db) =>
    db.query("select private.confirm_emission_numbering($1,'001','00001',0)", [
      t,
    ]),
  );
});
afterAll(async () => {
  await f?.pool.end();
});
it("fails closed for the global switch without reserving a number", async () => {
  await expect(
    run((db) =>
      issuePreparedInvoice(db, row, randomUUID(), f.userId, {
        ...config,
        HACIENDA_STAG_EMISSION_ENABLED: "false",
      }),
    ),
  ).rejects.toThrow("STAG");
  expect(
    (
      await f.pool.query(
        "select last_value from private.emission_sequences where tenant_id=$1",
        [row.tenant_id],
      )
    ).rows[0].last_value,
  ).toBe("0");
});
it("requires actual verified certificate identity and hides cross-company metadata", async () => {
  await f.pool.query(
    "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1",
    [row.tenant_id, { ...certificate, identity_status: "pending" }],
  );
  const readiness = await run((db) => emissionReadiness(db, row, config));
  expect(readiness.canEmit).toBe(false);
  expect(readiness.issues.map((i) => i.code)).toContain(
    "CERTIFICATE_IDENTITY_UNVERIFIED",
  );
  expect(
    await run(
      async (db) =>
        (
          await db.query("select private.invoice_emission_metadata($1,$2) m", [
            f.tenants[1],
            row.id,
          ])
        ).rows[0].m,
    ),
  ).toBeNull();
  await f.pool.query(
    "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1",
    [row.tenant_id, certificate],
  );
});
it("rejects incomplete issuer XML data before consuming numbering", async () => {
  const snapshot = {
    ...row.snapshot,
    issuer: {
      ...row.snapshot.issuer,
      configuration: {
        location: { province: "1", canton: "01", district: "" },
      },
    },
  };
  await f.pool.query(
    "update public.electronic_invoices set snapshot=$2 where id=$1",
    [row.id, snapshot],
  );
  try {
    await expect(
      run((db) =>
        issuePreparedInvoice(db, row, randomUUID(), f.userId, config),
      ),
    ).rejects.toThrow("XML");
    expect(
      (
        await f.pool.query(
          "select last_value from private.emission_sequences where tenant_id=$1",
          [row.tenant_id],
        )
      ).rows[0].last_value,
    ).toBe("0");
  } finally {
    await f.pool.query(
      "update public.electronic_invoices set snapshot=$2 where id=$1",
      [row.id, row.snapshot],
    );
  }
});
it("serializes two confirmations into one issued invoice and one sign job", async () => {
  const ready = await run((db) => emissionReadiness(db, row, config));
  expect(ready.issues).toEqual([]);
  const [a, b] = await Promise.all([
    run((db) => issuePreparedInvoice(db, row, randomUUID(), f.userId, config)),
    run((db) => issuePreparedInvoice(db, row, randomUUID(), f.userId, config)),
  ]);
  expect(a.clave).toBe(b.clave);
  expect(a.consecutivo).toBe("00100001010000000001");
  expect(a.issued_by).toBe(f.userId);
  expect(
    (
      await f.pool.query(
        "select last_value from private.emission_sequences where tenant_id=$1",
        [row.tenant_id],
      )
    ).rows[0].last_value,
  ).toBe("1");
  expect(
    (
      await f.pool.query(
        "select count(*) from private.emission_jobs where invoice_id=$1",
        [row.id],
      )
    ).rows[0].count,
  ).toBe("1");
  await expect(
    f.pool.query(
      "update public.electronic_invoices set snapshot='{}' where id=$1",
      [row.id],
    ),
  ).rejects.toThrow("IMMUTABLE");
});
it("does not permit decreasing a confirmed sequence or direct authenticated confirmation", async () => {
  await expect(
    run((db) =>
      db.query(
        "select private.confirm_emission_numbering($1,'001','00001',0)",
        [row.tenant_id],
      ),
    ),
  ).rejects.toThrow("SEQUENCE_CANNOT_DECREASE");
  const db = await f.pool.connect();
  try {
    await db.query("begin");
    await db.query("set local role authenticated");
    await expect(
      db.query(
        "select private.confirm_emission_numbering($1,'001','00001',2)",
        [row.tenant_id],
      ),
    ).rejects.toThrow("permission denied");
  } finally {
    await db.query("rollback");
    db.release();
  }
});

it("workers authorize the actual issuer when the preparer is a different user", async () => {
  const j = (
    await f.pool.query(
      "update private.emission_jobs set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where invoice_id=$1 returning *",
      [row.id],
    )
  ).rows[0];
  const read = () =>
    run(
      async (db) =>
        (
          await db.query("select * from private.emission_job_document($1,$2)", [
            j.id,
            j.lease_token,
          ])
        ).rows,
    );
  expect((await read())[0].id).toBe(row.id);
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission='invoices.emit' and role_id in(select role_id from public.membership_roles where tenant_id=$1 and user_id=$2)",
    [row.tenant_id, f.userId],
  );
  try {
    expect(await read()).toEqual([]);
  } finally {
    await f.pool.query(
      "insert into public.role_permissions(tenant_id,role_id,permission) select tenant_id,role_id,'invoices.emit' from public.membership_roles where tenant_id=$1 and user_id=$2 on conflict do nothing",
      [row.tenant_id, f.userId],
    );
  }
});
it("requires MFA even for an issued replay and rejects cross-company identifiers", async () => {
  const saved = claims;
  claims = { ...claims, aal: "aal1" };
  try {
    await expect(
      run((db) =>
        issuePreparedInvoice(db, row, randomUUID(), f.userId, config),
      ),
    ).rejects.toThrow();
    await expect(
      run((db) =>
        db.query(
          "select private.confirm_emission_numbering($1,'001','00001',2)",
          [row.tenant_id],
        ),
      ),
    ).rejects.toThrow("FORBIDDEN");
  } finally {
    claims = saved;
  }
  await expect(
    run((db) =>
      issuePreparedInvoice(
        db,
        { ...row, tenant_id: f.tenants[1] },
        randomUUID(),
        f.userId,
        config,
      ),
    ),
  ).rejects.toThrow("no encontrada");
});
