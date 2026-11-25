import type pg from "pg";
import type { Job } from "./emission-jobs";

/** Internal leased-job reads; never impersonates an interactive user's JWT. */
export class EmissionWorkerStore {
  constructor(private readonly pool: pg.Pool) {}

  async document(job: Job): Promise<any | null> {
    const result = await this.pool.query(
      "select * from private.emission_job_document($1,$2)",
      [job.id, job.lease_token],
    );
    return result.rows[0] ?? null;
  }

  async update(job: Job, patch: Record<string, unknown>): Promise<any | null> {
    const result = await this.pool.query(
      "select * from private.emission_job_update($1,$2,$3::jsonb)",
      [job.id, job.lease_token, JSON.stringify(patch)],
    );
    return result.rows[0] ?? null;
  }

  async credentials(job: Job): Promise<any | null> {
    const result = await this.pool.query(
      "select * from private.emission_job_credentials($1,$2)",
      [job.id, job.lease_token],
    );
    return result.rows[0] ?? null;
  }
}
