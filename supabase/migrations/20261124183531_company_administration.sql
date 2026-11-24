-- Owner-only company administration. No owner identity is hardcoded or granted here.
create function private.is_system_administrator() returns boolean language sql stable security definer set search_path='' as $$
 select private.valid_session() and auth.jwt()->>'aal'='aal2' and exists(select 1 from private.platform_operators where user_id=auth.uid());
$$;
revoke all on function private.is_system_administrator() from public;
grant execute on function private.is_system_administrator() to authenticated,conta_facil_api;
create or replace function private.has_access(t uuid,p text,d uuid default null) returns boolean language sql stable security definer set search_path='' as $$
select private.valid_session() and exists(select 1 from public.memberships m join public.tenants tnt on tnt.id=m.tenant_id where m.tenant_id=t and m.user_id=auth.uid() and m.active and tnt.active
and exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=t and mr.user_id=m.user_id and rp.permission=p)
and (m.scope='company' or (d is not null and exists(select 1 from public.membership_departments md where md.tenant_id=t and md.user_id=m.user_id and md.department_id=d)))
and (auth.jwt()->>'aal'='aal2' or not exists(select 1 from public.membership_roles mr join public.roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id where mr.tenant_id=t and mr.user_id=m.user_id and r.code='admin'))
and (p not like '%.manage' or auth.jwt()->>'aal'='aal2')
and (p not in ('company.manage','users.manage','organization.manage','tax.manage','hacienda.credentials.manage','hacienda.connection.test') or private.is_system_administrator()));
$$;
alter table public.tenants
 add column person_type text not null default 'unspecified' check(person_type in ('physical','legal','unspecified')),
 add column configuration jsonb not null default '{}' check(jsonb_typeof(configuration)='object' and octet_length(configuration::text)<=131072 and configuration::text !~* '"(password|pin|username|pkcs12_base64|private_key|service_role)"\s*:'),
 add column configuration_version integer not null default 1 check(configuration_version>0),
 add column updated_at timestamptz not null default now(),
 add column created_by uuid references public.profiles,
 add column updated_by uuid references public.profiles;
alter table public.economic_activities add column is_primary boolean not null default false;
create unique index economic_activity_primary on public.economic_activities(tenant_id) where active and is_primary;
create index tenants_identification_lookup on public.tenants(identification_type,identification);
create function private.company_version() returns trigger language plpgsql set search_path='' as $$
begin new.configuration_version=old.configuration_version+1; new.updated_at=now(); new.updated_by=auth.uid(); return new; end $$;
revoke all on function private.company_version() from public;
create trigger company_version before update on public.tenants for each row execute function private.company_version();
create table private.company_operations(actor_id uuid not null references public.profiles,operation_id uuid not null,request_hash text not null,tenant_id uuid not null references public.tenants,created_at timestamptz not null default now(),primary key(actor_id,operation_id));
alter table private.company_operations enable row level security;
revoke all on private.company_operations from public,anon,authenticated;
grant select,insert on private.company_operations to conta_facil_api;
create policy server_internal_access on private.company_operations for all to conta_facil_api using(true) with check(true);
create table public.document_sequences(tenant_id uuid not null references public.tenants,branch_id uuid not null,terminal_id uuid not null,document_type text not null check(document_type in ('FE','TE','NC','ND','FEC','FEE','REP')),last_value numeric(10,0) not null default 0 check(last_value>=0),created_at timestamptz not null default now(),primary key(tenant_id,terminal_id,document_type),foreign key(tenant_id,branch_id) references public.branches(tenant_id,id),foreign key(tenant_id,terminal_id) references public.terminals(tenant_id,id));
alter table public.document_sequences enable row level security;
revoke all on public.document_sequences from public,anon,authenticated;
grant select on public.document_sequences to authenticated;
grant select,insert on public.document_sequences to conta_facil_api;
create policy sequence_read on public.document_sequences for select to authenticated using(private.has_access(tenant_id,'tax.read'));
create policy server_internal_access on public.document_sequences for all to conta_facil_api using(true) with check(true);
notify pgrst,'reload schema';
