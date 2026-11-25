-- A worker without an interactive JWT needs only this non-secret policy value
-- before acquiring a lease. Execution still reauthorizes the leased document.
-- The job's composite FK fixes tenant, invoice and environment; no caller can
-- supply a different document or obtain invoice contents through this helper.
create function private.emission_job_trust_policy(job uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(i.response_trust_policy,'pinned_certificate')
 from private.emission_jobs j
 join public.electronic_invoices i on i.tenant_id=j.tenant_id and i.id=j.invoice_id and i.environment=j.environment
 where j.id=job;
$$;
revoke all on function private.emission_job_trust_policy(uuid) from public,anon,authenticated;
grant execute on function private.emission_job_trust_policy(uuid) to conta_facil_api;
