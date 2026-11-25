-- Fiscal environments share no revision, ciphertext context or operator review.
-- Existing test rows and their AES-GCM AAD remain unchanged.
alter table public.hacienda_configuration
 drop constraint hacienda_configuration_environment_check,
 add constraint hacienda_configuration_environment_check check(environment in('test','production'));
alter table private.hacienda_credential_versions
 drop constraint hacienda_credential_versions_environment_check,
 add constraint hacienda_credential_versions_environment_check check(environment in('test','production'));

-- This is an explicit administrative assertion, not an official certificate
-- ownership/PKI validator. The technical inspector's identity_status stays pending.
create table private.hacienda_credential_enrollments(
 tenant_id uuid not null,
 environment text not null check(environment in('test','production')),
 version integer not null check(version>0),
 issuer_identification text not null,
 issuer_identification_type text not null check(issuer_identification_type in('01','02','03','04')),
 certificate_fingerprint text not null check(certificate_fingerprint ~ '^[a-f0-9]{64}$'),
 status text not null default 'operator_verified' check(status='operator_verified'),
 confirmed_by uuid not null references public.profiles,
 confirmed_at timestamptz not null default now(),
 evidence_reference text not null check(
  evidence_reference=btrim(evidence_reference)
  and length(evidence_reference) between 1 and 500
  and evidence_reference !~ '[[:cntrl:]]'
 ),
 primary key(tenant_id,environment,version),
 foreign key(tenant_id,environment,version)
  references private.hacienda_credential_versions(tenant_id,environment,version),
 check(case issuer_identification_type
  when '01' then issuer_identification ~ '^[0-9]{9}$'
  when '02' then issuer_identification ~ '^[0-9]{10}$'
  when '03' then issuer_identification ~ '^[0-9]{11,12}$'
  when '04' then issuer_identification ~ '^[0-9]{10}$'
  else false end)
);
alter table private.hacienda_credential_enrollments enable row level security;
revoke all on private.hacienda_credential_enrollments from public,anon,authenticated;
grant select,insert on private.hacienda_credential_enrollments to conta_facil_api;
create policy enrollment_read on private.hacienda_credential_enrollments
 for select to conta_facil_api using(private.hacienda_access(tenant_id,'hacienda.read'));
create policy enrollment_insert on private.hacienda_credential_enrollments
 for insert to conta_facil_api with check(
  private.hacienda_access(tenant_id,'hacienda.credentials.manage')
  and private.hacienda_access(tenant_id,'hacienda.read')
  and confirmed_by=auth.uid()
 );

create function private.validate_hacienda_enrollment()
returns trigger language plpgsql security definer set search_path='' as $$
declare company public.tenants; configuration public.hacienda_configuration;
begin
 if not coalesce(private.hacienda_access(new.tenant_id,'hacienda.credentials.manage')
  and private.hacienda_access(new.tenant_id,'hacienda.read'),false)
  or new.confirmed_by is distinct from auth.uid() then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 -- Same lock order as the API, also protecting inserts from identity changes.
 select * into company from public.tenants where id=new.tenant_id for update;
 select * into configuration from public.hacienda_configuration
  where tenant_id=new.tenant_id and environment=new.environment for update;
 if configuration.active_version is distinct from new.version
  or configuration.api_status is distinct from 'success'
  or configuration.certificate_metadata->>'technical_status' is distinct from 'valid_local'
  or not coalesce((configuration.certificate_metadata->>'valid_from')::timestamptz<=pg_catalog.now()
   and (configuration.certificate_metadata->>'valid_until')::timestamptz>pg_catalog.now(),false)
  or new.issuer_identification is distinct from company.identification
  or new.issuer_identification_type is distinct from company.identification_type
  or new.certificate_fingerprint is distinct from pg_catalog.lower(pg_catalog.replace(configuration.certificate_metadata->>'fingerprint',':',''))
  or not exists(select 1 from private.hacienda_credential_versions v
   where v.tenant_id=new.tenant_id and v.environment=new.environment and v.version=new.version and v.active)
 then raise exception using errcode='23514',message='INVALID_HACIENDA_ENROLLMENT'; end if;
 return new;
end $$;
revoke all on function private.validate_hacienda_enrollment() from public,anon,authenticated;
create trigger validate_hacienda_enrollment before insert on private.hacienda_credential_enrollments
 for each row execute function private.validate_hacienda_enrollment();

create function private.guard_hacienda_enrollment_history()
returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Hacienda enrollment history is immutable';
end $$;
revoke all on function private.guard_hacienda_enrollment_history() from public,anon,authenticated;
create trigger hacienda_enrollment_history before update or delete on private.hacienda_credential_enrollments
 for each row execute function private.guard_hacienda_enrollment_history();

-- Interactive Hacienda metadata. Invoice/worker capability functions must read
-- the matching review inside their own authorization boundary so invoice readers
-- are not accidentally required to have Hacienda configuration permissions.
create function private.hacienda_enrollment(t uuid,e text,v integer)
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.to_jsonb(r)-'tenant_id'
 from private.hacienda_credential_enrollments r
 join public.tenants company on company.id=r.tenant_id
 join public.hacienda_configuration configuration on configuration.tenant_id=r.tenant_id
  and configuration.environment=r.environment and configuration.active_version=r.version
 join private.hacienda_credential_versions credential on credential.tenant_id=r.tenant_id
  and credential.environment=r.environment and credential.version=r.version and credential.active
 where r.tenant_id=t and r.environment=e and r.version=v
  and private.hacienda_access(t,'hacienda.read')
  and company.identification=r.issuer_identification
  and company.identification_type=r.issuer_identification_type
  and pg_catalog.lower(pg_catalog.replace(configuration.certificate_metadata->>'fingerprint',':',''))=r.certificate_fingerprint
  and r.status='operator_verified';
$$;
revoke all on function private.hacienda_enrollment(uuid,text,integer) from public,anon,authenticated;
grant execute on function private.hacienda_enrollment(uuid,text,integer) to conta_facil_api;

notify pgrst,'reload schema';
