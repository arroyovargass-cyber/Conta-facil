import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { FiscalLookups } from "../../apps/api/src/services/fiscal-lookups";
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
  identity_status: "pending",
  fingerprint: "a".repeat(64),
  valid_from: "2020-01-01",
  valid_until: "2099-01-01",
  fixture:
    "TEST ONLY: synthetic technical metadata and administrative review; no official identity attestation",
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
  vi.spyOn(FiscalLookups.prototype, "cabys").mockImplementation(
    async (code) => ({
      available: true,
      source: "Hacienda",
      items: [{ code, description: "Catálogo sintético de pruebas" }],
    }),
  );
  vi.spyOn(FiscalLookups.prototype, "recipient").mockImplementation(
    async (identification) => ({
      available: true,
      source: "Hacienda",
      source_url: "https://api.hacienda.go.cr/fe/ae",
      recipient: { name: "Contribuyente sintético", identification },
      activities: [
        { code: "123456", description: "Actividad sintética", active: true },
      ],
    }),
  );
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
  await run((db) =>
    db.query(
      "insert into private.hacienda_credential_enrollments(tenant_id,environment,version,issuer_identification,issuer_identification_type,certificate_fingerprint,confirmed_by,evidence_reference) values($1,'test',1,$2,$3,$4,$5,'TEST ONLY: synthetic administrative review')",
      [
        t,
        issuer.identification,
        issuer.identification_type,
        certificate.fingerprint,
        f.userId,
      ],
    ),
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
  vi.restoreAllMocks();
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
  ).rejects.toThrow("Pruebas");
  expect(
    (
      await f.pool.query(
        "select last_value from private.emission_sequences where tenant_id=$1",
        [row.tenant_id],
      )
    ).rows[0].last_value,
  ).toBe("0");
});
it("requires a current administrative review and hides cross-company metadata", async () => {
  await f.pool.query(
    "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1",
    [
      row.tenant_id,
      {
        ...certificate,
        identity_status: "verified",
        fingerprint: "b".repeat(64),
      },
    ],
  );
  const readiness = await run((db) => emissionReadiness(db, row, config));
  expect(readiness.canEmit).toBe(false);
  expect(readiness.issues.map((i) => i.code)).toContain(
    "CERTIFICATE_ENROLLMENT_REQUIRED",
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
    ).rejects.toThrow("provincia");
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
it("keeps issuer identity and reviewed credentials stable while issuance is checked", async () => {
  const issuingDb = await f.pool.connect(),
    replacingDb = await f.pool.connect();
  let reached!: () => void,
    rejectReached!: (error: unknown) => void,
    resume!: () => void;
  const metadataReached = new Promise<void>((resolve, reject) => {
    reached = resolve;
    rejectReached = reject;
  });
  const continueIssuance = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const originalQuery = issuingDb.query.bind(issuingDb);
  let paused = false;
  await issuingDb.query("begin");
  await issuingDb.query("set local role conta_facil_api");
  await issuingDb.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify(claims),
  ]);
  issuingDb.query = (async (sql: string, values?: unknown[]) => {
    const result = await originalQuery(sql, values);
    if (sql.includes("private.invoice_emission_metadata") && !paused) {
      paused = true;
      reached();
      await continueIssuance;
    }
    return result;
  }) as typeof issuingDb.query;
  const issuing = issuePreparedInvoice(
    issuingDb,
    row,
    randomUUID(),
    f.userId,
    config,
  );
  void issuing.catch(rejectReached);
  try {
    await metadataReached;
    await replacingDb.query("begin");
    await replacingDb.query("set local lock_timeout='200ms'");
    // Custody replacement and company edits take this same tenant write lock.
    await expect(
      replacingDb.query(
        "select id from public.tenants where id=$1 for update",
        [row.tenant_id],
      ),
    ).rejects.toThrow("lock timeout");
  } finally {
    // Release the competing write lock before the issuance FK checks continue,
    // including when the regression is observed before the share lock exists.
    await replacingDb.query("rollback");
    resume();
    try {
      const issued = await issuing;
      expect(issued.credential_version).toBe(1);
      expect(issued.certificate_fingerprint).toBe(certificate.fingerprint);
    } finally {
      issuingDb.query = originalQuery as typeof issuingDb.query;
      await issuingDb.query("rollback");
      issuingDb.release();
      replacingDb.release();
    }
  }
});
it("serializes two confirmations into one issued invoice and one sign job", async () => {
  await f.pool.query("revoke usage on schema auth from conta_facil_api");
  try {
    const ready = await run((db) => emissionReadiness(db, row, config));
    expect(ready.issues).toEqual([]);
    const [a, b] = await Promise.all([
      run((db) =>
        issuePreparedInvoice(db, row, randomUUID(), f.userId, config),
      ),
      run((db) =>
        issuePreparedInvoice(db, row, randomUUID(), f.userId, config),
      ),
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
  } finally {
    await f.pool.query("grant usage on schema auth to conta_facil_api");
  }
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
    // Tenant grants do not restrict the explicit platform owner role.
    expect((await read())[0].id).toBe(row.id);
    await f.pool.query(
      "delete from private.platform_operators where user_id=$1",
      [f.userId],
    );
    expect(await read()).toEqual([]);
  } finally {
    await f.pool.query(
      "insert into private.platform_operators(user_id) values($1) on conflict do nothing",
      [f.userId],
    );
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
it("issues local synthetic production fixtures only with their own review, confirmation and sequence", async () => {
  const production = (
    await f.pool.query(
      "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash,environment) values($1,$2,1,$3,$4,$5,$6,$7,$8,'production') returning *",
      [
        row.tenant_id,
        row.draft_id,
        row.department_id,
        row.snapshot,
        row.options,
        f.userId,
        randomUUID(),
        "e".repeat(64),
      ],
    )
  ).rows[0];
  await f.pool.query(
    "insert into public.hacienda_configuration(tenant_id,environment,certificate_metadata,api_status) values($1,'production',$2,'success')",
    [row.tenant_id, certificate],
  );
  await f.pool.query(
    "insert into private.hacienda_credential_versions(tenant_id,environment,version,api_key_id,api_ciphertext,pkcs12_key_id,pkcs12_ciphertext,created_by) values($1,'production',1,'TEST',$2,'TEST',$2,$3)",
    [row.tenant_id, Buffer.alloc(28), f.userId],
  );
  await f.pool.query(
    "update public.hacienda_configuration set active_version=1 where tenant_id=$1 and environment='production'",
    [row.tenant_id],
  );
  await run((db) =>
    db.query(
      "insert into private.hacienda_credential_enrollments(tenant_id,environment,version,issuer_identification,issuer_identification_type,certificate_fingerprint,confirmed_by,evidence_reference) values($1,'production',1,$2,$3,$4,$5,'TEST ONLY: local synthetic production fixture; no external submission')",
      [
        row.tenant_id,
        row.snapshot.issuer.identification,
        row.snapshot.issuer.identification_type,
        certificate.fingerprint,
        f.userId,
      ],
    ),
  );
  await run((db) =>
    db.query(
      "select private.confirm_emission_numbering($1,'001','00001',0,'production')",
      [row.tenant_id],
    ),
  );
  const productionConfig = {
    ...config,
    HACIENDA_STAG_EMISSION_ENABLED: "false",
    HACIENDA_PRODUCTION_EMISSION_ENABLED: "true",
    HACIENDA_RESPONSE_TRUST_POLICY: "official_api",
    HACIENDA_RESPONSE_CERTIFICATE_PINS: undefined,
  };
  expect(
    (await run((db) => emissionReadiness(db, production, productionConfig)))
      .issues,
  ).toEqual([]);
  await expect(
    run((db) =>
      issuePreparedInvoice(
        db,
        production,
        randomUUID(),
        f.userId,
        productionConfig,
      ),
    ),
  ).rejects.toThrow("Confirma expresamente");
  const operation = randomUUID();
  const issued = await run((db) =>
    issuePreparedInvoice(
      db,
      production,
      operation,
      f.userId,
      productionConfig,
      true,
    ),
  );
  expect(issued.environment).toBe("production");
  expect(issued.consecutivo).toBe("00100001010000000001");
  expect(issued.response_trust_policy).toBe("official_api");
  const replay = await run((db) =>
    issuePreparedInvoice(db, production, operation, f.userId, {
      ...productionConfig,
      HACIENDA_PRODUCTION_EMISSION_ENABLED: "false",
    }),
  );
  expect(replay.id).toBe(issued.id);
  expect(replay.version).toBe(issued.version);
  const sequences = (
    await f.pool.query(
      "select environment,last_value from private.emission_sequences where tenant_id=$1 order by environment",
      [row.tenant_id],
    )
  ).rows;
  expect(sequences).toEqual([
    { environment: "production", last_value: "1" },
    { environment: "test", last_value: "1" },
  ]);
  await expect(
    f.pool.query(
      "update public.electronic_invoices set environment='test' where id=$1",
      [issued.id],
    ),
  ).rejects.toThrow("IMMUTABLE");
});
