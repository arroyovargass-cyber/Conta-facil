-- Internal worker capabilities substitute for an expired interactive session. They
-- authorize only the leased document, and recheck the original actor's live scope.
alter table public.electronic_invoices
 add column clave text check(clave ~ '^[0-9]{50}$'),
 add column consecutivo text check(consecutivo ~ '^[0-9]{20}$'),
 add column issued_at timestamptz,
 add column credential_version integer,
 add column public_certificate_pem text check(octet_length(public_certificate_pem)<=8192),
 add foreign key(tenant_id,environment,credential_version)
 references private.hacienda_credential_versions(tenant_id,environment,version);

create table private.invoice_artifacts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,invoice_id uuid not null,
 kind text not null check(kind in('signed_xml','hacienda_response','pdf')),
 content bytea not null check(octet_length(content)<=4194304),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
 unique(tenant_id,invoice_id,kind,sha256),
 foreign key(tenant_id,invoice_id) references public.electronic_invoices(tenant_id,id)
);
alter table private.invoice_artifacts enable row level security;
revoke all on private.invoice_artifacts from public,anon,authenticated;
grant select,insert on private.invoice_artifacts to conta_facil_api;
create policy invoice_artifacts_worker on private.invoice_artifacts for select to conta_facil_api using(true);
create policy invoice_artifacts_worker_insert on private.invoice_artifacts for insert to conta_facil_api with check(true);

create function private.emission_job_document(job uuid,token uuid)
returns setof public.electronic_invoices language sql stable security definer set search_path='' as $$
 select i.* from private.emission_jobs j
 join public.electronic_invoices i on i.tenant_id=j.tenant_id and i.id=j.invoice_id
 where j.id=job and j.lease_token=token and j.status='leased' and j.lease_until>pg_catalog.now()
 and (
   (j.kind='query' and i.transmission_status in('sent','uncertain','processing'))
   or exists(
    select 1 from public.memberships m
    join public.profiles p on p.id=m.user_id
    join public.tenants t on t.id=m.tenant_id
    where m.tenant_id=i.tenant_id and m.user_id=i.created_by and m.active and p.active and t.active
    and exists(select 1 from public.membership_roles mr join public.role_permissions rp
      on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
      where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission='invoices.emit')
    and (m.scope='company' or exists(select 1 from public.membership_departments md
      where md.tenant_id=m.tenant_id and md.user_id=m.user_id and md.department_id=i.department_id))
   )
 );
$$;
revoke all on function private.emission_job_document(uuid,uuid) from public,anon,authenticated;
grant execute on function private.emission_job_document(uuid,uuid) to conta_facil_api;

create function private.emission_job_credentials(job uuid,token uuid)
returns setof private.hacienda_credential_versions language sql stable security definer set search_path='' as $$
 select c.* from private.emission_job_document(job,token) i
 join private.emission_jobs j on j.id=job and j.tenant_id=i.tenant_id and j.invoice_id=i.id
 join private.hacienda_credential_versions c on c.tenant_id=i.tenant_id and c.environment=i.environment and c.version=i.credential_version
 where j.kind in('sign','transmit','query') and (j.kind='query' or c.active);
$$;
revoke all on function private.emission_job_credentials(uuid,uuid) from public,anon,authenticated;
grant execute on function private.emission_job_credentials(uuid,uuid) to conta_facil_api;
notify pgrst,'reload schema';

-- Serialize state writes with lease invalidation, and never accept identity or
-- document-content fields through this capability.
create function private.emission_job_update(job uuid,token uuid,patch jsonb)
returns setof public.electronic_invoices language plpgsql security definer set search_path='' as $$
declare k text; i public.electronic_invoices;
begin
 select j.kind into k from private.emission_jobs j where j.id=job and j.lease_token=token
 and j.status='leased' and j.lease_until>pg_catalog.now() for update;
 if not found then return; end if;
 select d.* into i from private.emission_job_document(job,token) d;
 if not found then return; end if;
 if pg_catalog.jsonb_typeof(patch)<>'object' or patch is null then raise exception 'INVALID_WORKER_PATCH';end if;
 if exists(select 1 from pg_catalog.jsonb_object_keys(patch) p(key) where
  not (case k when 'sign' then p.key in('signature_status','public_certificate_pem','transmission_status')
   when 'transmit' then p.key='transmission_status'
   when 'query' then p.key in('transmission_status','hacienda_status')
   when 'email' then p.key='email_status' else false end))
 or exists(select 1 from pg_catalog.jsonb_each(patch) p(key,value) where pg_catalog.jsonb_typeof(p.value)<>'string')
 or (patch ? 'transmission_status' and not(case k
  when 'sign' then patch->>'transmission_status'='queued'
  when 'transmit' then patch->>'transmission_status' in('sent','uncertain','technical_error')
  when 'query' then patch->>'transmission_status' in('processing','sent','technical_error') else false end))
 or (patch ? 'signature_status' and patch->>'signature_status'<>'signed')
 or (patch ? 'hacienda_status' and patch->>'hacienda_status' not in('pending','accepted','rejected'))
 or (patch ? 'email_status' and patch->>'email_status' not in('queued','processing','provider_accepted','uncertain','error'))
 then raise exception 'INVALID_WORKER_PATCH';end if;
 if (i.hacienda_status in('accepted','rejected') and patch ? 'hacienda_status' and patch->>'hacienda_status'<>i.hacienda_status)
 or (k='sign' and i.transmission_status in('sent','uncertain','processing'))
 or (k='transmit' and (i.signature_status<>'signed' or i.document_status<>'issued'))
 then raise exception 'INVALID_WORKER_TRANSITION';end if;
 if patch->>'hacienda_status' in('accepted','rejected') and not exists(select 1 from private.invoice_artifacts a
 where a.tenant_id=i.tenant_id and a.invoice_id=i.id and a.kind='hacienda_response') then
 raise exception 'HACIENDA_RESPONSE_REQUIRED'; end if;
 return query update public.electronic_invoices d set
 signature_status=coalesce(patch->>'signature_status',d.signature_status),
 transmission_status=coalesce(patch->>'transmission_status',d.transmission_status),
 hacienda_status=coalesce(patch->>'hacienda_status',d.hacienda_status),
 email_status=coalesce(patch->>'email_status',d.email_status),
 public_certificate_pem=coalesce(patch->>'public_certificate_pem',d.public_certificate_pem),version=d.version+1
 where d.tenant_id=i.tenant_id and d.id=i.id returning d.*;
end $$;
revoke all on function private.emission_job_update(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.emission_job_update(uuid,uuid,jsonb) to conta_facil_api;
