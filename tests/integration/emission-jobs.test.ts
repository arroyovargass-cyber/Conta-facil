import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { EmissionJobs } from "../../apps/api/src/services/emission-jobs";
let f: Awaited<ReturnType<typeof workspace>>,
  queue: EmissionJobs,
  invoiceId: string,
  productionInvoiceId: string;
let otherJobTimes: {
  id: string;
  available_at: Date;
  lease_until: Date | null;
}[] = [];
beforeAll(async () => {
  f = await workspace();
  queue = new EmissionJobs(f.pool);
  const tenant = f.tenants[0];
  const dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Queue') returning id",
      [tenant],
    )
  ).rows[0].id;
  const customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Queue') returning id",
      [tenant],
    )
  ).rows[0].id;
  const draft = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{}',$4,$4,$5,'queue') returning id",
      [tenant, customer, dep, f.userId, randomUUID()],
    )
  ).rows[0].id;
  invoiceId = (
    await f.pool.query(
      "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash) values($1,$2,1,$3,'{}','{}',$4,$5,$6) returning id",
      [tenant, draft, dep, f.userId, randomUUID(), "a".repeat(64)],
    )
  ).rows[0].id;
  productionInvoiceId = (
    await f.pool.query(
      "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash,environment) values($1,$2,1,$3,'{}','{}',$4,$5,$6,'production') returning id",
      [tenant, draft, dep, f.userId, randomUUID(), "b".repeat(64)],
    )
  ).rows[0].id;
  // The queue is intentionally global. Temporarily defer unrelated local fixture
  // jobs so this serial file can assert exact claims without consuming their work.
  otherJobTimes = (
    await f.pool.query(
      "select id,available_at,lease_until from private.emission_jobs where invoice_id<>all($1::uuid[]) and status in('pending','leased')",
      [[invoiceId, productionInvoiceId]],
    )
  ).rows;
  await f.pool.query(
    "update private.emission_jobs set available_at=now()+interval '1 day',lease_until=case when status='leased' then now()+interval '1 day' else lease_until end where invoice_id<>all($1::uuid[]) and status in('pending','leased')",
    [[invoiceId, productionInvoiceId]],
  );
});
afterAll(async () => {
  await f?.pool.query(
    "delete from private.emission_jobs where invoice_id=any($1::uuid[])",
    [[invoiceId, productionInvoiceId]],
  );
  if (otherJobTimes.length)
    await f.pool.query(
      "update private.emission_jobs j set available_at=x.available_at,lease_until=x.lease_until from jsonb_to_recordset($1::jsonb) as x(id uuid,available_at timestamptz,lease_until timestamptz) where j.id=x.id",
      [JSON.stringify(otherJobTimes)],
    );
  await f?.pool.end();
});
async function enqueue(
  kind: "sign" | "query" | "pdf" | "transmit" | "email",
  selectedInvoice = invoiceId,
) {
  const db = await f.pool.connect();
  try {
    return await queue.enqueue(db, {
      tenantId: f.tenants[0],
      invoiceId: selectedInvoice,
      kind,
    });
  } finally {
    db.release();
  }
}
it("enqueues transactionally, idempotently, and excludes clients", async () => {
  const db = await f.pool.connect();
  try {
    await db.query("begin");
    await queue.enqueue(db, { tenantId: f.tenants[0], invoiceId, kind: "pdf" });
    await db.query("rollback");
  } finally {
    db.release();
  }
  expect(
    (
      await f.pool.query(
        "select * from private.emission_jobs where invoice_id=$1",
        [invoiceId],
      )
    ).rowCount,
  ).toBe(0);
  expect(await enqueue("sign")).toBe(await enqueue("sign"));
  expect(
    (
      await f.pool.query(
        "select has_table_privilege('authenticated','private.emission_jobs','SELECT') allowed,has_table_privilege('conta_facil_api','private.emission_jobs','UPDATE') worker",
      )
    ).rows[0],
  ).toEqual({ allowed: false, worker: true });
  const worker = await f.pool.connect();
  try {
    await worker.query("begin");
    await worker.query("set local role conta_facil_api");
    expect(
      (
        await worker.query(
          "select id from private.emission_jobs where invoice_id=$1",
          [invoiceId],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      await queue.enqueue(worker, {
        tenantId: f.tenants[0],
        invoiceId,
        kind: "sign",
      }),
    ).toBeTruthy();
  } finally {
    await worker.query("rollback");
    worker.release();
  }
});
it("claims concurrently without duplicates and fences expired tokens", async () => {
  await enqueue("query");
  const [a, b] = await Promise.all([queue.claim(), queue.claim()]);
  expect(a).toHaveLength(1);
  expect(b).toHaveLength(1);
  expect(a[0].id).not.toBe(b[0].id);
  await f.pool.query(
    "update private.emission_jobs set lease_until=now()-interval '1 second' where invoice_id=$1",
    [invoiceId],
  );
  expect(await queue.finish(a[0], { status: "completed" })).toBe(false);
  const reclaimed = await queue.claim(4);
  expect(reclaimed).toHaveLength(2);
  expect(reclaimed[0].attempts).toBe(2);
  expect(await queue.finish(a[0], { status: "completed" })).toBe(false);
  for (const job of reclaimed)
    expect(await queue.finish(job, { status: "completed" })).toBe(true);
});
it("does not replay expired external effects and bounds retries", async () => {
  await enqueue("transmit");
  await enqueue("email");
  const external = await queue.claim(4);
  expect(external).toHaveLength(2);
  await f.pool.query(
    "update private.emission_jobs set lease_until=now()-interval '1 second' where invoice_id=$1 and status='leased'",
    [invoiceId],
  );
  expect(await queue.claim(4)).toHaveLength(0);
  expect(
    (
      await f.pool.query(
        "select distinct status from private.emission_jobs where invoice_id=$1 and kind in ('transmit','email')",
        [invoiceId],
      )
    ).rows,
  ).toEqual([{ status: "uncertain" }]);
  await enqueue("pdf");
  const [job] = await queue.claim();
  await expect(
    queue.finish(job, { status: "failed", errorCode: "secret with spaces" }),
  ).rejects.toThrow();
  await f.pool.query(
    "update private.emission_jobs set attempts=8 where id=$1",
    [job.id],
  );
  expect(
    await queue.finish(job, { status: "pending", retryInSeconds: 1 }),
  ).toBe(true);
  expect(
    (
      await f.pool.query(
        "select status from private.emission_jobs where id=$1",
        [job.id],
      )
    ).rows[0].status,
  ).toBe("failed");
});
it("recovers a query for uncertain transmitted documents without scheduling a second POST", async () => {
  await f.pool.query(
    "update public.electronic_invoices set transmission_status='uncertain' where id=$1",
    [invoiceId],
  );
  await f.pool.query(
    "delete from private.emission_jobs where invoice_id=$1 and kind in('query','transmit')",
    [invoiceId],
  );
  await enqueue("transmit");
  await f.pool.query(
    "update private.emission_jobs set status='uncertain' where invoice_id=$1 and kind='transmit'",
    [invoiceId],
  );
  await f.pool.query("select private.recover_uncertain_emissions()");
  await f.pool.query("select private.recover_uncertain_emissions()");
  const r = await f.pool.query(
    "select kind,status from private.emission_jobs where invoice_id=$1 and kind in('query','transmit') order by kind",
    [invoiceId],
  );
  expect(r.rows).toEqual([
    { kind: "query", status: "pending" },
    { kind: "transmit", status: "uncertain" },
  ]);
});
it("serializes missing job creation with the manual-action job key until commit", async () => {
  const a = await f.pool.connect(),
    b = await f.pool.connect();
  const key = f.tenants[0] + ":" + invoiceId + ":pdf";
  try {
    await a.query("begin");
    await b.query("begin");
    await queue.enqueue(a, { tenantId: f.tenants[0], invoiceId, kind: "pdf" });
    expect(
      (
        await b.query(
          "select pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",
          [key],
        )
      ).rows[0].locked,
    ).toBe(false);
    await a.query("rollback");
    expect(
      (
        await b.query(
          "select pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",
          [key],
        )
      ).rows[0].locked,
    ).toBe(true);
  } finally {
    await a.query("rollback");
    await b.query("rollback");
    a.release();
    b.release();
  }
});

it("does not claim or expire work in a disabled environment, and recovers only enabled consultations", async () => {
  // Recovery may have created consultations for other fixtures after beforeAll.
  // Defer those too, preserving their original schedule for cleanup.
  const additionalJobs = (
    await f.pool.query(
      "select id,available_at,lease_until from private.emission_jobs where invoice_id<>all($1::uuid[]) and id<>all($2::uuid[]) and status in('pending','leased')",
      [[invoiceId, productionInvoiceId], otherJobTimes.map((job) => job.id)],
    )
  ).rows;
  otherJobTimes.push(...additionalJobs);
  await f.pool.query(
    "update private.emission_jobs set available_at=now()+interval '1 day',lease_until=case when status='leased' then now()+interval '1 day' else lease_until end where invoice_id<>all($1::uuid[]) and status in('pending','leased')",
    [[invoiceId, productionInvoiceId]],
  );
  await f.pool.query("delete from private.emission_jobs where invoice_id=$1", [
    invoiceId,
  ]);
  await enqueue("sign", productionInvoiceId);
  await enqueue("transmit", productionInvoiceId);
  expect(await queue.claim(4)).toEqual([]);
  expect(
    (
      await f.pool.query(
        "select distinct attempts from private.emission_jobs where invoice_id=$1",
        [productionInvoiceId],
      )
    ).rows,
  ).toEqual([{ attempts: 0 }]);

  const jobs = await queue.claim(4, ["production"]);
  expect(jobs).toHaveLength(2);
  expect(jobs.every((job) => job.environment === "production")).toBe(true);
  await f.pool.query(
    "update private.emission_jobs set lease_until=now()-interval '1 second' where invoice_id=$1",
    [productionInvoiceId],
  );
  expect(await queue.claim(4, ["test"])).toEqual([]);
  expect(
    (
      await f.pool.query(
        "select distinct status,attempts,last_error_code from private.emission_jobs where invoice_id=$1",
        [productionInvoiceId],
      )
    ).rows,
  ).toEqual([{ status: "leased", attempts: 1, last_error_code: null }]);

  const reclaimed = await queue.claim(4, ["production"]);
  expect(reclaimed).toHaveLength(1);
  expect(reclaimed[0]).toMatchObject({
    kind: "sign",
    attempts: 2,
    environment: "production",
  });
  await queue.finish(reclaimed[0], { status: "completed" });
  await f.pool.query(
    "update public.electronic_invoices set transmission_status='uncertain' where id=$1",
    [productionInvoiceId],
  );
  await f.pool.query("select private.recover_uncertain_emissions()");
  expect(
    (
      await f.pool.query(
        "select id from private.emission_jobs where invoice_id=$1 and kind='query'",
        [productionInvoiceId],
      )
    ).rows,
  ).toEqual([]);
  await f.pool.query(
    "select private.recover_uncertain_emissions(array['production'])",
  );
  expect(
    (
      await f.pool.query(
        "select kind,status,environment,attempts from private.emission_jobs where invoice_id=$1 and kind in ('query','transmit') order by kind",
        [productionInvoiceId],
      )
    ).rows,
  ).toEqual([
    {
      kind: "query",
      status: "pending",
      environment: "production",
      attempts: 0,
    },
    {
      kind: "transmit",
      status: "uncertain",
      environment: "production",
      attempts: 1,
    },
  ]);
});

it("selects each document's stored trust policy without consuming unavailable-policy jobs", async () => {
  await f.pool.query(
    "delete from private.emission_jobs where invoice_id=any($1::uuid[])",
    [[invoiceId, productionInvoiceId]],
  );
  await f.pool.query(
    "update public.electronic_invoices set response_trust_policy=case when id=$1 then 'official_api' else 'pinned_certificate' end where id=any($2::uuid[])",
    [invoiceId, [invoiceId, productionInvoiceId]],
  );
  await enqueue("query", invoiceId);
  const blocked = await enqueue("query", productionInvoiceId);
  const available = { test: ["official_api" as const], production: [] };
  const jobs = await queue.claim(4, ["test", "production"], available);
  expect(jobs.map((job) => job.invoice_id)).toEqual([invoiceId]);
  expect(
    (
      await f.pool.query(
        "select attempts,status from private.emission_jobs where id=$1",
        [blocked],
      )
    ).rows,
  ).toEqual([{ attempts: 0, status: "pending" }]);
  for (const job of jobs) await queue.finish(job, { status: "completed" });
  expect(await queue.claim(4, ["test", "production"], available)).toEqual([]);
  expect(
    (
      await f.pool.query(
        "select has_function_privilege('authenticated','private.emission_job_trust_policy(uuid)','EXECUTE') interactive,has_function_privilege('anon','private.emission_job_trust_policy(uuid)','EXECUTE') anonymous",
      )
    ).rows[0],
  ).toEqual({ interactive: false, anonymous: false });
  const db = await f.pool.connect();
  try {
    await db.query("begin");
    await db.query("set local role conta_facil_api");
    expect(
      (
        await db.query("select private.emission_job_trust_policy($1) policy", [
          blocked,
        ])
      ).rows[0].policy,
    ).toBe("pinned_certificate");
    expect(
      (
        await db.query(
          "select id from public.electronic_invoices where id=$1",
          [productionInvoiceId],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await db.query("rollback");
    db.release();
  }
});
