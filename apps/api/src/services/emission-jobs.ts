import type pg from "pg";
import type { HaciendaEnvironment } from "../../../../packages/domain/src/hacienda-environment";
export type JobKind = "sign" | "transmit" | "query" | "pdf" | "email";
export type JobTrustPolicy = "official_api" | "pinned_certificate";
export type JobTrustEligibility = Partial<
  Record<HaciendaEnvironment, readonly JobTrustPolicy[]>
>;
export interface Job {
  id: string;
  tenant_id: string;
  invoice_id: string;
  environment: HaciendaEnvironment;
  kind: JobKind;
  status: "leased";
  attempts: number;
  lease_token: string;
  lease_until: Date;
}
const kinds: readonly string[] = ["sign", "transmit", "query", "pdf", "email"];
/** Durable internal queue. Handlers must reauthorize before any external effect. */
export class EmissionJobs {
  constructor(private readonly pool: pg.Pool) {}
  async enqueue(
    db: pg.PoolClient,
    input: { tenantId: string; invoiceId: string; kind: JobKind },
  ): Promise<string> {
    if (!kinds.includes(input.kind)) throw new Error("INVALID_JOB_KIND");
    // The caller owns the transaction; share this key with manual actions and recovery.
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${input.tenantId.toLowerCase()}:${input.invoiceId.toLowerCase()}:${input.kind}`,
    ]);
    const result = await db.query(
      `insert into private.emission_jobs(tenant_id,invoice_id,kind) values($1,$2,$3)
   on conflict(tenant_id,invoice_id,kind) do update set kind=excluded.kind returning id`,
      [input.tenantId, input.invoiceId, input.kind],
    );
    return result.rows[0].id;
  }
  async claim(
    limit = 1,
    environments: readonly HaciendaEnvironment[] = ["test"],
    trustPolicies?: JobTrustEligibility,
  ): Promise<Job[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 4)
      throw new Error("INVALID_CLAIM_LIMIT");
    if (
      !Array.isArray(environments) ||
      environments.some(
        (environment) => !["test", "production"].includes(environment),
      )
    )
      throw new Error("INVALID_JOB_ENVIRONMENTS");
    if (!environments.length) return [];
    if (
      trustPolicies &&
      Object.entries(trustPolicies).some(
        ([environment, policies]) =>
          !["test", "production"].includes(environment) ||
          !Array.isArray(policies) ||
          policies.some(
            (policy) =>
              !["official_api", "pinned_certificate"].includes(policy),
          ),
      )
    )
      throw new Error("INVALID_JOB_TRUST_POLICIES");
    const db = await this.pool.connect();
    try {
      await db.query("begin");
      // Expired external effects cannot be retried safely without reconciliation.
      await db.query(
        `update private.emission_jobs set
    status=case when kind in ('transmit','email') then 'uncertain' when attempts>=8 then 'failed' else 'pending' end,
    lease_token=null,lease_until=null,last_error_code='LEASE_EXPIRED'
    where status='leased' and lease_until<=now() and environment=any($1::text[])`,
        [environments],
      );
      const result = await db.query<Job>(
        `with candidates as (
    select id from private.emission_jobs where status='pending' and attempts<8 and available_at<=now()
    and environment=any($2::text[])
    and (case environment when 'test' then $3::text[] else $4::text[] end is null
      or private.emission_job_trust_policy(id)=any(case environment when 'test' then $3::text[] else $4::text[] end))
    and kind in ('sign','transmit','query','pdf','email')
    order by available_at,created_at,id for update skip locked limit $1
   ) update private.emission_jobs j set status='leased',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
    from candidates c where j.id=c.id returning j.id,j.tenant_id,j.invoice_id,j.environment,j.kind,j.status,j.attempts,j.lease_token,j.lease_until`,
        [
          limit,
          environments,
          trustPolicies ? (trustPolicies.test ?? []) : null,
          trustPolicies ? (trustPolicies.production ?? []) : null,
        ],
      );
      await db.query("commit");
      return result.rows;
    } catch (error) {
      await db.query("rollback");
      throw error;
    } finally {
      db.release();
    }
  }
  async finish(
    job: Job,
    result: {
      status: "completed" | "failed" | "uncertain" | "pending";
      errorCode?: string;
      retryInSeconds?: number;
    },
  ): Promise<boolean> {
    if (
      !["completed", "failed", "uncertain", "pending"].includes(result.status)
    )
      throw new Error("INVALID_JOB_STATUS");
    if (
      result.errorCode !== undefined &&
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(result.errorCode)
    )
      throw new Error("INVALID_ERROR_CODE");
    const retry = result.retryInSeconds ?? 1;
    if (!Number.isInteger(retry) || retry < 1 || retry > 3600)
      throw new Error("INVALID_RETRY_DELAY");
    const updated = await this.pool.query(
      `update private.emission_jobs set
   status=case when $3='pending' and attempts>=8 then 'failed' else $3 end,
   available_at=case when $3='pending' then now()+$5*interval '1 second' else available_at end,
   completed_at=case when $3='completed' then now() else null end,
   last_error_code=$4,lease_token=null,lease_until=null
   where id=$1 and lease_token=$2 and status='leased' and lease_until>now()`,
      [job.id, job.lease_token, result.status, result.errorCode ?? null, retry],
    );
    return updated.rowCount === 1;
  }
}
