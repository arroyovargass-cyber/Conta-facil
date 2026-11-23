-- Preparation only. No electronic issuance, fiscal acceptance or account balances.
insert into public.permission_catalog(code,module,action) values
('hacienda.read','hacienda','read'),('hacienda.credentials.manage','hacienda','manage'),('hacienda.connection.test','hacienda','test'),
('collections.read','collections','read'),('collections.manage','collections','manage'),
('payables.read','payables','read'),('payables.manage','payables','manage'),('document_workflow.assign','document_workflow','assign');
insert into public.role_permissions(tenant_id,role_id,permission)
select r.tenant_id,r.id,p.code from public.roles r cross join public.permission_catalog p
where r.code='admin' and p.module in('hacienda','collections','payables','document_workflow') on conflict do nothing;
-- New permissions deliberately remain opt-in for accountants/auditors and other roles.
create or replace function private.seed_roles() returns trigger language plpgsql security definer set search_path='' as $$
begin
insert into public.roles(tenant_id,code,name) values(new.id,'admin','Administrador de empresa'),(new.id,'accountant','Contador'),(new.id,'billing','Encargado de facturación'),(new.id,'reception','Encargado de recepción'),(new.id,'department','Jefe de departamento'),(new.id,'operative','Usuario operativo'),(new.id,'auditor','Auditor de solo lectura');
insert into public.role_permissions select new.id,r.id,p.code from public.roles r cross join public.permission_catalog p where r.tenant_id=new.id and
(r.code='admin' or (r.code in('accountant','auditor') and p.action='read' and p.module not in('hacienda','collections','payables','document_workflow')) or
(r.code in('billing','reception','department','operative') and p.code in('company.read','organization.read')) or
(r.code='billing' and p.code in('customers.read','catalog.read','invoices.read','invoices.manage')));
return new;
end $$;
create function private.hacienda_access(t uuid,p text) returns boolean language sql stable security definer set search_path='' as $$
select auth.jwt()->>'aal'='aal2' and private.has_access(t,p,null)
and exists(select 1 from public.memberships m where m.tenant_id=t and m.user_id=auth.uid() and m.active and m.scope='company');
$$;
revoke all on function private.hacienda_access(uuid,text) from public;
grant execute on function private.hacienda_access(uuid,text) to authenticated,conta_facil_api;
create table public.hacienda_configuration(
 tenant_id uuid not null references public.tenants,environment text not null default 'test' check(environment='test'),
 revision integer not null default 0 check(revision>=0),active_version integer,
 certificate_metadata jsonb check(certificate_metadata is null or (jsonb_typeof(certificate_metadata)='object' and octet_length(certificate_metadata::text)<4096)),
 api_status text not null default 'not_tested' check(api_status in('not_tested','success','authentication_failed','service_unavailable')),
 api_checked_at timestamptz,session_closed boolean,updated_at timestamptz not null default now(),
 primary key(tenant_id,environment)
);
create table private.hacienda_credential_versions(
 tenant_id uuid not null,environment text not null check(environment='test'),version integer not null check(version>0),
 api_key_id text not null,api_ciphertext bytea not null check(octet_length(api_ciphertext) between 28 and 16384),
 pkcs12_key_id text not null,pkcs12_ciphertext bytea not null check(octet_length(pkcs12_ciphertext) between 28 and 3000000),
 active boolean not null default true,created_by uuid not null references public.profiles,created_at timestamptz not null default now(),
 primary key(tenant_id,environment,version),foreign key(tenant_id,environment) references public.hacienda_configuration
);
create unique index hacienda_single_active on private.hacienda_credential_versions(tenant_id,environment) where active;
alter table public.hacienda_configuration add foreign key(tenant_id,environment,active_version) references private.hacienda_credential_versions(tenant_id,environment,version);
create table public.document_routes(
 tenant_id uuid not null references public.tenants,flow text not null check(flow in('collections','payables')),
 target_department_id uuid,assignee_id uuid,enabled boolean not null default false,version integer not null default 1 check(version>0),updated_at timestamptz not null default now(),
 primary key(tenant_id,flow),foreign key(tenant_id,target_department_id) references public.departments(tenant_id,id),
 foreign key(tenant_id,assignee_id) references public.memberships(tenant_id,user_id),check(not enabled or target_department_id is not null)
);
create table public.document_work_items(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,
 source_kind text not null default 'invoice_draft' check(source_kind='invoice_draft'),source_id uuid not null,
 source_department_id uuid not null,source_version integer not null check(source_version>0),current_version integer not null check(current_version>0),
 flow text not null default 'collections' check(flow='collections'),target_department_id uuid not null,assignee_id uuid,
 customer_name text not null check(length(customer_name) between 1 and 160),
 state text not null default 'pending' check(state in('pending','in_review','resolved','archived')),
 version integer not null default 1 check(version>0),created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,source_kind,source_id,flow),
 foreign key(tenant_id,source_id) references public.invoice_drafts(tenant_id,id),
 foreign key(tenant_id,source_department_id) references public.departments(tenant_id,id),
 foreign key(tenant_id,target_department_id) references public.departments(tenant_id,id),
 foreign key(tenant_id,assignee_id) references public.memberships(tenant_id,user_id)
);
create index document_work_inbox on public.document_work_items(tenant_id,target_department_id,state,created_at desc);
create index document_routes_department on public.document_routes(tenant_id,target_department_id) where enabled;
create function private.workflow_configuration_access(t uuid) returns boolean language sql stable security definer set search_path='' as $$
select private.has_access(t,'company.manage',null) and private.has_access(t,'organization.manage',null);
$$;
revoke all on function private.workflow_configuration_access(uuid) from public;
grant execute on function private.workflow_configuration_access(uuid) to authenticated,conta_facil_api;
alter table public.hacienda_configuration enable row level security;
alter table private.hacienda_credential_versions enable row level security;
alter table public.document_routes enable row level security;
alter table public.document_work_items enable row level security;
revoke all on public.hacienda_configuration,public.document_routes,public.document_work_items from anon,authenticated;
revoke all on private.hacienda_credential_versions from public,anon,authenticated;
grant select on public.hacienda_configuration,public.document_routes,public.document_work_items to authenticated;
grant select,insert,update on public.hacienda_configuration,public.document_routes,public.document_work_items,private.hacienda_credential_versions to conta_facil_api;
create policy metadata_read on public.hacienda_configuration for select to authenticated,conta_facil_api using(private.hacienda_access(tenant_id,'hacienda.read'));
create policy metadata_insert on public.hacienda_configuration for insert to conta_facil_api with check(private.hacienda_access(tenant_id,'hacienda.credentials.manage'));
create policy metadata_update on public.hacienda_configuration for update to conta_facil_api using(private.hacienda_access(tenant_id,'hacienda.credentials.manage') or private.hacienda_access(tenant_id,'hacienda.connection.test')) with check(private.hacienda_access(tenant_id,'hacienda.credentials.manage') or private.hacienda_access(tenant_id,'hacienda.connection.test'));
create policy secrets_read on private.hacienda_credential_versions for select to conta_facil_api using(private.hacienda_access(tenant_id,'hacienda.credentials.manage') or private.hacienda_access(tenant_id,'hacienda.connection.test'));
create policy secrets_insert on private.hacienda_credential_versions for insert to conta_facil_api with check(private.hacienda_access(tenant_id,'hacienda.credentials.manage') and created_by=auth.uid());
create policy secrets_update on private.hacienda_credential_versions for update to conta_facil_api using(private.hacienda_access(tenant_id,'hacienda.credentials.manage')) with check(private.hacienda_access(tenant_id,'hacienda.credentials.manage'));
create policy route_read on public.document_routes for select to authenticated,conta_facil_api using(private.workflow_configuration_access(tenant_id));
create policy route_insert on public.document_routes for insert to conta_facil_api with check(private.workflow_configuration_access(tenant_id));
create policy route_update on public.document_routes for update to conta_facil_api using(private.workflow_configuration_access(tenant_id)) with check(private.workflow_configuration_access(tenant_id));
create policy work_read on public.document_work_items for select to authenticated,conta_facil_api using(private.has_access(tenant_id,'collections.read',target_department_id));
create policy work_insert on public.document_work_items for insert to conta_facil_api with check(private.has_access(tenant_id,'invoices.manage',source_department_id) and private.has_access(tenant_id,'document_workflow.assign',source_department_id) and created_by=auth.uid());
create policy work_update on public.document_work_items for update to conta_facil_api using(private.has_access(tenant_id,'collections.manage',target_department_id)) with check(private.has_access(tenant_id,'collections.manage',target_department_id));
create function private.guard_credential_history() returns trigger language plpgsql set search_path='' as $$
begin
if (to_jsonb(new)-'active') is distinct from (to_jsonb(old)-'active') or old.active=false then raise exception 'Credential history is immutable';end if;
return new;
end $$;
revoke all on function private.guard_credential_history() from public;
create trigger credential_history before update on private.hacienda_credential_versions for each row execute function private.guard_credential_history();
create function private.guard_work_identity() returns trigger language plpgsql set search_path='' as $$
begin
if row(new.tenant_id,new.source_kind,new.source_id,new.source_department_id,new.flow,new.customer_name,new.created_by,new.created_at)
is distinct from row(old.tenant_id,old.source_kind,old.source_id,old.source_department_id,old.flow,old.customer_name,old.created_by,old.created_at) then raise exception 'Workflow identity is immutable';end if;
return new;
end $$;
revoke all on function private.guard_work_identity() from public;
create trigger work_identity before update on public.document_work_items for each row execute function private.guard_work_identity();
create function private.refresh_draft_work() returns trigger language plpgsql security definer set search_path='' as $$
begin
if new.version is distinct from old.version then
update public.document_work_items set current_version=new.version,version=version+1,updated_at=now() where tenant_id=new.tenant_id and source_id=new.id;
end if;return new;
end $$;
revoke all on function private.refresh_draft_work() from public;
create trigger refresh_work after update on public.invoice_drafts for each row execute function private.refresh_draft_work();
create function private.guard_routed_department() returns trigger language plpgsql security definer set search_path='' as $$
begin
if old.active and not new.active and exists(select 1 from public.document_routes where tenant_id=new.tenant_id and target_department_id=new.id and enabled) then raise exception 'Department has an enabled document route';end if;
return new;
end $$;
revoke all on function private.guard_routed_department() from public;
create trigger guard_route before update on public.departments for each row execute function private.guard_routed_department();
notify pgrst,'reload schema';
