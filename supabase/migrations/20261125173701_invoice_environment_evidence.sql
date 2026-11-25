-- Fiscal environment belongs to the prepared document and every dependent job.
-- Existing documents retain test, with no fiscal counters or states invented.
alter table public.electronic_invoices
 drop constraint electronic_invoices_environment_check,
 add constraint electronic_invoices_environment_check check(environment in('test','production')),
 drop constraint electronic_invoices_tenant_id_draft_id_key,
 add constraint electronic_invoices_tenant_draft_environment_key unique(tenant_id,draft_id,environment),
 add constraint electronic_invoices_tenant_id_environment_key unique(tenant_id,id,environment),
 add constraint electronic_invoices_pinned_credential_key unique(tenant_id,id,environment,credential_version),
 add column response_trust_policy text check(response_trust_policy in('official_api','pinned_certificate'));
grant update(response_trust_policy) on public.electronic_invoices to conta_facil_api;

alter table private.emission_sequences
 drop constraint emission_sequences_environment_check,
 add constraint emission_sequences_environment_check check(environment in('test','production'));

alter table private.emission_jobs add column environment text not null default 'test';
update private.emission_jobs j set environment=i.environment
 from public.electronic_invoices i where i.tenant_id=j.tenant_id and i.id=j.invoice_id;
alter table private.emission_jobs
 add constraint emission_jobs_environment_check check(environment in('test','production')),
 add constraint emission_jobs_invoice_environment_fk foreign key(tenant_id,invoice_id,environment)
 references public.electronic_invoices(tenant_id,id,environment);

-- Queue inserts also run without an interactive JWT. This narrowly scoped
-- trigger reads only the referenced document and cannot choose another origin.
create function private.bind_emission_job_environment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if row(new.tenant_id,new.invoice_id,new.environment,new.kind)
   is distinct from row(old.tenant_id,old.invoice_id,old.environment,old.kind) then
   raise exception 'EMISSION_JOB_BINDING_IMMUTABLE';
  end if;
 else
  select i.environment into new.environment from public.electronic_invoices i
   where i.tenant_id=new.tenant_id and i.id=new.invoice_id;
  if not found then raise exception 'INVALID_JOB_INVOICE';end if;
 end if;
 return new;
end $$;
revoke all on function private.bind_emission_job_environment() from public,anon,authenticated;
create trigger emission_job_environment before insert or update on private.emission_jobs
 for each row execute function private.bind_emission_job_environment();
create index emission_jobs_environment_pending on private.emission_jobs(environment,available_at,created_at,id) where status='pending';
create index emission_jobs_environment_leases on private.emission_jobs(environment,lease_until) where status='leased';

-- Replace the old arity rather than introduce an ambiguous defaulted overload.
-- Four-argument callers and old zero-argument recovery both still mean test.
drop function private.confirm_emission_numbering(uuid,text,text,numeric);
create function private.confirm_emission_numbering(t uuid,b text,tr text,starting_value numeric,e text default 'test')
returns void language plpgsql security definer set search_path='' as $$
declare floor_value numeric; selected_branch uuid; selected_terminal uuid;
begin
 if not private.is_system_administrator() or not private.has_access(t,'tax.manage',null) then raise exception 'FORBIDDEN';end if;
 if e is null or e not in('test','production') then raise exception 'INVALID_ENVIRONMENT';end if;
 if starting_value is null or starting_value<>trunc(starting_value) or starting_value<0 or starting_value>9999999999 then raise exception 'INVALID_SEQUENCE';end if;
 select br.id,te.id into selected_branch,selected_terminal from public.branches br
 join public.terminals te on te.tenant_id=br.tenant_id and te.branch_id=br.id
 where br.tenant_id=t and br.code=b and te.code=tr and br.active and te.active for update of br,te;
 if not found then raise exception 'INVALID_BRANCH_TERMINAL';end if;
 perform 1 from public.document_sequences s where s.tenant_id=t and s.branch_id=selected_branch and s.terminal_id=selected_terminal for update;
 select coalesce(max(s.last_value),0) into floor_value from public.document_sequences s
 where s.tenant_id=t and s.branch_id=selected_branch and s.terminal_id=selected_terminal and s.document_type='FE';
 if starting_value<floor_value then raise exception 'LEGACY_SEQUENCE_FLOOR';end if;
 insert into private.emission_sequences(tenant_id,environment,branch_code,terminal_code,last_value,confirmed_by,confirmed_at,legacy_floor)
 values(t,e,b,tr,starting_value,auth.uid(),now(),floor_value)
 on conflict(tenant_id,environment,branch_code,terminal_code) do update set
  last_value=excluded.last_value,confirmed_by=excluded.confirmed_by,
  confirmed_at=excluded.confirmed_at,legacy_floor=excluded.legacy_floor
 where private.emission_sequences.last_value<=excluded.last_value;
 if not found then raise exception 'SEQUENCE_CANNOT_DECREASE';end if;
 insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details)
 values(t,auth.uid(),'CONFIRM_EMISSION_NUMBERING','emission_sequences',b||tr,
  jsonb_build_object('environment',e,'starting_value',starting_value,'legacy_floor',floor_value));
end $$;
revoke all on function private.confirm_emission_numbering(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function private.confirm_emission_numbering(uuid,text,text,numeric,text) to conta_facil_api;

drop function private.recover_uncertain_emissions();
create function private.recover_uncertain_emissions(environments text[] default array['test'])
returns integer language plpgsql security definer set search_path='' as $$
declare d record; count_rows integer:=0; inserted integer;
begin
 if environments is null or array_position(environments,null) is not null
  or not environments <@ array['test','production']::text[] then raise exception 'INVALID_ENVIRONMENT';end if;
 for d in
  select i.tenant_id,i.id from public.electronic_invoices i
  where i.environment=any(environments) and i.transmission_status in('uncertain','sent','processing') and i.hacienda_status='pending'
  and not exists(select 1 from private.emission_jobs q where q.tenant_id=i.tenant_id and q.invoice_id=i.id and q.kind='query')
  and exists(select 1 from private.emission_jobs j where j.tenant_id=i.tenant_id and j.invoice_id=i.id and j.kind='transmit'
    and (j.status in('uncertain','completed','failed') or (j.status='leased' and j.lease_until<=now())))
  order by i.id limit 100
 loop
  -- UUID text is canonical lower case, matching manual actions and enqueue.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(d.tenant_id::text||':'||d.id::text||':query',0));
  insert into private.emission_jobs(tenant_id,invoice_id,kind) values(d.tenant_id,d.id,'query')
  on conflict(tenant_id,invoice_id,kind) do nothing;
  get diagnostics inserted=row_count;count_rows=count_rows+inserted;
 end loop;
 return count_rows;
end $$;
revoke all on function private.recover_uncertain_emissions(text[]) from public,anon,authenticated;
grant execute on function private.recover_uncertain_emissions(text[]) to conta_facil_api;

create or replace function private.invoice_emission_metadata(t uuid,i uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'company',(select jsonb_build_object('identification',tnt.identification,'identification_type',tnt.identification_type,
  'configuration_version',tnt.configuration_version,'send_email',tnt.configuration->'billing'->'send_email')
  from public.tenants tnt where tnt.id=d.tenant_id and tnt.active),
 'activity',exists(select 1 from public.economic_activities a where a.tenant_id=d.tenant_id and a.code=d.options->>'issuer_activity' and a.active),
 'terminal',exists(select 1 from public.branches b join public.terminals tr on tr.tenant_id=b.tenant_id and tr.branch_id=b.id
  where b.tenant_id=d.tenant_id and b.code=d.options->>'branch_code' and tr.code=d.options->>'terminal_code' and b.active and tr.active),
 'credential_version',v.version,'certificate_metadata',c.certificate_metadata,'api_status',c.api_status,
 -- Invoice readers need readiness metadata even when they cannot open Hacienda
 -- settings. The outer invoice authorization gates this narrowly scoped read.
 'enrollment',(select jsonb_build_object('environment',e.environment,'version',e.version,'status',e.status,
  'issuer_identification',e.issuer_identification,'issuer_identification_type',e.issuer_identification_type,
  'certificate_fingerprint',e.certificate_fingerprint,'confirmed_by',e.confirmed_by,
  'confirmed_at',e.confirmed_at,'evidence_reference',e.evidence_reference)
  from private.hacienda_credential_enrollments e join public.tenants tnt on tnt.id=e.tenant_id
  where e.tenant_id=d.tenant_id and e.environment=d.environment and e.version=v.version and e.status='operator_verified'
   and e.certificate_fingerprint=pg_catalog.lower(pg_catalog.replace(c.certificate_metadata->>'fingerprint',':',''))
   and e.issuer_identification=tnt.identification and e.issuer_identification_type=tnt.identification_type and tnt.active),
 'numbering',(select jsonb_build_object('last_value',s.last_value,'confirmed_at',s.confirmed_at,'legacy_floor',s.legacy_floor)
  from private.emission_sequences s where s.tenant_id=d.tenant_id and s.environment=d.environment
   and s.branch_code=d.options->>'branch_code' and s.terminal_code=d.options->>'terminal_code'))
 from public.electronic_invoices d
 left join public.hacienda_configuration c on c.tenant_id=d.tenant_id and c.environment=d.environment
 left join private.hacienda_credential_versions v on v.tenant_id=c.tenant_id and v.environment=c.environment and v.version=c.active_version and v.active
 where d.tenant_id=t and d.id=i and private.has_access(t,'invoices.read',d.department_id);
$$;
revoke all on function private.invoice_emission_metadata(uuid,uuid) from public,anon;
grant execute on function private.invoice_emission_metadata(uuid,uuid) to authenticated,conta_facil_api;

create or replace function private.guard_issued_invoice() returns trigger language plpgsql set search_path='' as $$
begin
 if old.document_status='issued' and row(new.snapshot,new.options,new.tenant_id,new.department_id,new.document_status,
  new.environment,new.document_type,new.draft_id,new.clave,new.consecutivo,new.issued_at,new.credential_version,
  new.certificate_fingerprint,new.issue_operation_id,new.issued_by,new.response_trust_policy)
 is distinct from row(old.snapshot,old.options,old.tenant_id,old.department_id,old.document_status,
  old.environment,old.document_type,old.draft_id,old.clave,old.consecutivo,old.issued_at,old.credential_version,
  old.certificate_fingerprint,old.issue_operation_id,old.issued_by,old.response_trust_policy) then
  raise exception 'ISSUED_INVOICE_IMMUTABLE';
 end if;
 if new.response_trust_policy is distinct from old.response_trust_policy and current_user='conta_facil_api'
  and not coalesce(private.has_access(new.tenant_id,'invoices.emit',new.department_id) and auth.jwt()->>'aal'='aal2',false) then
  raise exception 'FORBIDDEN';
 end if;
 return new;
end $$;
revoke all on function private.guard_issued_invoice() from public,anon,authenticated;

create table private.invoice_response_observations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,invoice_id uuid not null,
 environment text not null check(environment in('test','production')),
 credential_version integer not null check(credential_version>0),
 response_sha256 text not null check(response_sha256 ~ '^[a-f0-9]{64}$'),
 evidence jsonb not null,
 created_at timestamptz not null default now(),
 unique(tenant_id,invoice_id,response_sha256),
 foreign key(tenant_id,invoice_id,environment,credential_version)
  references public.electronic_invoices(tenant_id,id,environment,credential_version),
 foreign key(tenant_id,environment,credential_version)
  references private.hacienda_credential_versions(tenant_id,environment,version),
 constraint response_observation_evidence_check check(coalesce(
  jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=32768
  and evidence->>'method'='official_api' and evidence->>'tenantId'=tenant_id::text
  and evidence->>'environment'=environment and evidence->'credentialVersion'=to_jsonb(credential_version)
  and evidence->>'responseSha256'=response_sha256 and evidence->>'rawJsonSha256' ~ '^[a-f0-9]{64}$'
  and evidence->>'clave' ~ '^[0-9]{50}$' and evidence->>'profile'=environment
  and evidence->'httpStatus'='200'::jsonb and evidence->'synthetic'='false'::jsonb
  and evidence->>'policyVersion'='official-api-v1'
  and evidence->>'responseSchemaSha256'='b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e'
  and evidence->>'certificateFingerprint' ~ '^[a-f0-9]{64}$'
  and evidence->>'verification'='xml_signature_and_correlation'
  and evidence->>'haciendaStatus' in('accepted','rejected')
  and evidence->>'observedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
  and evidence->>'endpoint'='https://api.comprobanteselectronicos.go.cr/'||
   case environment when 'test' then 'recepcion-sandbox' else 'recepcion' end||'/v1/recepcion/'||(evidence->>'clave'),false))
);
alter table private.invoice_response_observations enable row level security;
revoke all on private.invoice_response_observations from public,anon,authenticated;
-- Inserts are available only through the fenced capability below.
grant select on private.invoice_response_observations to conta_facil_api;
create policy response_observations_worker on private.invoice_response_observations
 for select to conta_facil_api using(true);

create function private.guard_response_observation_history() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'RESPONSE_OBSERVATION_IMMUTABLE';end $$;
revoke all on function private.guard_response_observation_history() from public,anon,authenticated;
create trigger response_observation_history before update or delete on private.invoice_response_observations
 for each row execute function private.guard_response_observation_history();

create function private.emission_job_observe_response(job uuid,token uuid,response_hash text,observation jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare k text; i public.electronic_invoices; observation_id uuid;
begin
 -- Preserve the worker's lock order: lease row before document row.
 select j.kind into k from private.emission_jobs j where j.id=job and j.lease_token=token
  and j.status='leased' and j.lease_until>pg_catalog.now() for update;
 if not found then return null;end if;
 if k<>'query' then raise exception 'INVALID_OBSERVATION_JOB';end if;
 select d.* into i from private.emission_job_document(job,token) d;
 if not found then return null;end if;
 select d.* into i from public.electronic_invoices d where d.tenant_id=i.tenant_id and d.id=i.id for update;
 if i.document_status<>'issued' or i.signature_status<>'signed'
  or i.transmission_status not in('sent','uncertain','processing')
  or i.response_trust_policy is distinct from 'official_api' or i.credential_version is null or i.clave is null then
  raise exception 'INVALID_OBSERVATION_DOCUMENT';
 end if;
 if response_hash is null or response_hash !~ '^[a-f0-9]{64}$' or observation is null
  or observation->>'clave' is distinct from i.clave
  or not exists(select 1 from private.invoice_artifacts a where a.tenant_id=i.tenant_id and a.invoice_id=i.id
   and a.kind='hacienda_response' and a.sha256=response_hash) then
  raise exception 'INVALID_RESPONSE_OBSERVATION';
 end if;
 begin
  perform (observation->>'observedAt')::timestamptz;
  insert into private.invoice_response_observations(tenant_id,invoice_id,environment,credential_version,response_sha256,evidence)
  values(i.tenant_id,i.id,i.environment,i.credential_version,response_hash,observation)
  on conflict(tenant_id,invoice_id,response_sha256) do nothing returning id into observation_id;
 exception when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception 'INVALID_RESPONSE_OBSERVATION';
 end;
 if observation_id is null then
  select o.id into observation_id from private.invoice_response_observations o
   where o.tenant_id=i.tenant_id and o.invoice_id=i.id and o.response_sha256=response_hash;
 end if;
 return observation_id;
end $$;
revoke all on function private.emission_job_observe_response(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.emission_job_observe_response(uuid,uuid,text,jsonb) to conta_facil_api;

-- Retain all existing patch/transition fences. Legacy null policies keep the
-- pinned-certificate path; official_api requires matching immutable evidence.
create or replace function private.emission_job_update(job uuid,token uuid,patch jsonb)
returns setof public.electronic_invoices language plpgsql security definer set search_path='' as $$
declare k text; i public.electronic_invoices;
begin
 select j.kind into k from private.emission_jobs j where j.id=job and j.lease_token=token
 and j.status='leased' and j.lease_until>pg_catalog.now() for update;
 if not found then return;end if;
 select d.* into i from private.emission_job_document(job,token) d;
 if not found then return;end if;
 select d.* into i from public.electronic_invoices d where d.tenant_id=i.tenant_id and d.id=i.id for update;
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
  raise exception 'HACIENDA_RESPONSE_REQUIRED';
 end if;
 if i.response_trust_policy='official_api' and patch->>'hacienda_status' in('accepted','rejected')
 and not exists(select 1 from private.invoice_response_observations o join private.invoice_artifacts a
  on a.tenant_id=o.tenant_id and a.invoice_id=o.invoice_id and a.sha256=o.response_sha256 and a.kind='hacienda_response'
  where o.tenant_id=i.tenant_id and o.invoice_id=i.id and o.environment=i.environment and o.credential_version=i.credential_version
   and o.evidence->>'haciendaStatus'=patch->>'hacienda_status') then
  raise exception 'HACIENDA_RESPONSE_OBSERVATION_REQUIRED';
 end if;
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
notify pgrst,'reload schema';
