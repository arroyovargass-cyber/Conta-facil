create table private.emission_jobs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null, invoice_id uuid not null,
 kind text not null check(kind in ('sign','transmit','query','pdf','email')),
 status text not null default 'pending' check(status in ('pending','leased','completed','failed','uncertain')),
 attempts integer not null default 0 check(attempts between 0 and 8),
 available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default now(), completed_at timestamptz,
 last_error_code text check(last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 unique(tenant_id,invoice_id,kind),
 foreign key(tenant_id,invoice_id) references public.electronic_invoices(tenant_id,id),
 check((status='leased')=(lease_token is not null and lease_until is not null))
);
create index emission_jobs_pending on private.emission_jobs(available_at,created_at,id) where status='pending';
create index emission_jobs_leases on private.emission_jobs(lease_until) where status='leased';
alter table private.emission_jobs enable row level security;
revoke all on private.emission_jobs from public,anon,authenticated;
grant select,insert,update,delete on private.emission_jobs to conta_facil_api;
-- Internal cross-tenant server queue; never granted to API client roles. The
-- worker reauthorizes invoice access before executing an external effect.
create policy emission_jobs_worker on private.emission_jobs for all to conta_facil_api using(true) with check(true);
