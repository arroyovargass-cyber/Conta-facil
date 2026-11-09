create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create table public.profiles(id uuid primary key references auth.users, name text not null, active boolean not null default true);
create table public.tenants(id uuid primary key default gen_random_uuid(),legal_name text not null check(length(trim(legal_name))>0),trade_name text not null default '',identification_type text not null,identification text not null,contact_email text not null default '',phone text not null default '',address text not null default '',active boolean not null default true,created_at timestamptz not null default now());
create table public.memberships(tenant_id uuid references public.tenants,id uuid default gen_random_uuid(),user_id uuid references public.profiles,active boolean not null default true,scope text not null default 'departments' check(scope in('company','departments')),primary key(tenant_id,user_id),unique(tenant_id,id));
create table public.departments(id uuid default gen_random_uuid(),tenant_id uuid references public.tenants,name text not null check(length(trim(name))>0),active boolean not null default true,created_at timestamptz default now(),primary key(id),unique(tenant_id,id),unique(tenant_id,name));
create table public.cost_centers(id uuid primary key default gen_random_uuid(),tenant_id uuid references public.tenants,department_id uuid not null,name text not null check(length(trim(name))>0),active boolean not null default true,unique(tenant_id,id),foreign key(tenant_id,department_id) references public.departments(tenant_id,id));
create table public.branches(id uuid primary key default gen_random_uuid(),tenant_id uuid references public.tenants,name text not null check(length(trim(name))>0),code text not null,active boolean not null default true,unique(tenant_id,id),unique(tenant_id,code));
create table public.terminals(id uuid primary key default gen_random_uuid(),tenant_id uuid references public.tenants,branch_id uuid not null,name text not null check(length(trim(name))>0),code text not null,active boolean not null default true,unique(tenant_id,id),unique(tenant_id,branch_id,code),foreign key(tenant_id,branch_id) references public.branches(tenant_id,id));
create table public.permission_catalog(code text primary key,module text not null,action text not null);
insert into public.permission_catalog values ('company.read','company','read'),('company.manage','company','manage'),('users.read','users','read'),('users.manage','users','manage'),('organization.read','organization','read'),('organization.manage','organization','manage'),('tax.read','tax','read'),('tax.manage','tax','manage'),('audit.read','audit','read');
create table public.roles(id uuid primary key default gen_random_uuid(),tenant_id uuid references public.tenants,code text not null,name text not null,unique(tenant_id,id),unique(tenant_id,code));
create table public.role_permissions(tenant_id uuid not null,role_id uuid not null,permission text references public.permission_catalog,primary key(tenant_id,role_id,permission),foreign key(tenant_id,role_id) references public.roles(tenant_id,id));
create table public.membership_roles(tenant_id uuid,user_id uuid,role_id uuid,primary key(tenant_id,user_id,role_id),foreign key(tenant_id,user_id) references public.memberships,foreign key(tenant_id,role_id) references public.roles(tenant_id,id));
create table public.membership_departments(tenant_id uuid,user_id uuid,department_id uuid,primary key(tenant_id,user_id,department_id),foreign key(tenant_id,user_id) references public.memberships,foreign key(tenant_id,department_id) references public.departments(tenant_id,id));
create table public.tax_settings(tenant_id uuid references public.tenants,environment text check(environment in('test','production')),status text not null default 'draft' check(status='draft'),currency text not null default 'CRC' check(currency in('CRC','USD')),source_url text not null default '',notes text not null default '',updated_at timestamptz not null default now(),primary key(tenant_id,environment));
create table public.economic_activities(id uuid primary key default gen_random_uuid(),tenant_id uuid references public.tenants,code text not null,name text not null,source_url text not null,active boolean default true,unique(tenant_id,code));
create table public.audit_events(id bigint generated always as identity primary key,tenant_id uuid references public.tenants,actor_id uuid,action text not null,entity text not null,entity_id text,details jsonb not null default '{}',created_at timestamptz not null default now());
create table private.login_directory(user_id uuid primary key references public.profiles,country text not null,identification_type text not null,identification text not null,email text not null unique,unique(country,identification_type,identification));
create table private.platform_operators(user_id uuid primary key references public.profiles);
create table private.sessions(id text primary key,user_id uuid not null references public.profiles,auth_session_id uuid not null,encrypted_tokens text not null,csrf_hash text not null,expires_at timestamptz not null,last_seen timestamptz not null default now(),revoked_at timestamptz);
create index on private.sessions(auth_session_id,user_id) where revoked_at is null;
create table private.rate_limits(key text primary key,count int not null,reset_at timestamptz not null);
create table private.access_events(id bigint generated always as identity primary key,user_id uuid,event text not null,created_at timestamptz not null default now());
create table private.invitations(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,email text not null,role_id uuid not null,scope text not null check(scope in('company','departments')),department_ids uuid[] not null default '{}',token_hash text not null unique,expires_at timestamptz not null,accepted_at timestamptz,foreign key(tenant_id,role_id) references public.roles(tenant_id,id));

create function private.valid_session() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from private.sessions s join public.profiles p on p.id=s.user_id where s.user_id=auth.uid() and p.active and s.auth_session_id::text=auth.jwt()->>'session_id' and s.revoked_at is null and s.expires_at>now() and s.last_seen>now()-interval '30 minutes');
$$;
create function private.has_access(t uuid,p text,d uuid default null) returns boolean language sql stable security definer set search_path='' as $$
select private.valid_session() and exists(select 1 from public.memberships m join public.tenants tnt on tnt.id=m.tenant_id where m.tenant_id=t and m.user_id=auth.uid() and m.active and tnt.active
and exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=t and mr.user_id=m.user_id and rp.permission=p)
and (m.scope='company' or (d is not null and exists(select 1 from public.membership_departments md where md.tenant_id=t and md.user_id=m.user_id and md.department_id=d)))
and (auth.jwt()->>'aal'='aal2' or not exists(select 1 from public.membership_roles mr join public.roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id where mr.tenant_id=t and mr.user_id=m.user_id and r.code='admin'))
and (p not like '%.manage' or auth.jwt()->>'aal'='aal2'));
$$;
revoke all on function private.valid_session(),private.has_access(uuid,text,uuid) from public;
grant execute on function private.valid_session(),private.has_access(uuid,text,uuid) to authenticated;

create function private.seed_roles() returns trigger language plpgsql security definer set search_path='' as $$
begin
insert into public.roles(tenant_id,code,name) values(new.id,'admin','Administrador de empresa'),(new.id,'accountant','Contador'),(new.id,'billing','Encargado de facturación'),(new.id,'reception','Encargado de recepción'),(new.id,'department','Jefe de departamento'),(new.id,'operative','Usuario operativo'),(new.id,'auditor','Auditor de solo lectura');
insert into public.role_permissions select new.id,r.id,p.code from public.roles r cross join public.permission_catalog p where r.tenant_id=new.id and (r.code='admin' or (r.code in('accountant','auditor') and p.action='read') or (r.code in('billing','reception','department','operative') and p.code in('company.read','organization.read')));
return new;
end $$;
revoke all on function private.seed_roles() from public;
create trigger seed_roles after insert on public.tenants for each row execute function private.seed_roles();

create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare obj jsonb; t uuid;
begin
obj=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
t=case when TG_TABLE_NAME='tenants' then (obj->>'id')::uuid else (obj->>'tenant_id')::uuid end;
insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details) values(t,auth.uid(),TG_OP,TG_TABLE_NAME,coalesce(obj->>'id',obj->>'user_id'),jsonb_build_object('fields', (select jsonb_agg(key) from jsonb_object_keys(obj) key)));
return coalesce(new,old);
end $$;
revoke all on function private.audit_change() from public;

-- Ordinary users never delete retained organization/history. Administration requires AAL2.
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
create policy self_profile on public.profiles for select to authenticated using(id=auth.uid() and private.valid_session());
alter table public.permission_catalog enable row level security;
grant select on public.permission_catalog to authenticated;
create policy permissions_read on public.permission_catalog for select to authenticated using(private.valid_session());
alter table public.tenants enable row level security;
grant select,update on public.tenants to authenticated;
create policy company_read on public.tenants for select to authenticated using(private.has_access(id,'company.read') or exists(select 1 from public.memberships m where m.tenant_id=id and m.user_id=auth.uid() and m.active and private.valid_session()));
create policy company_update on public.tenants for update to authenticated using(private.has_access(id,'company.manage')) with check(private.has_access(id,'company.manage'));

DO $$ declare tab text; mod text; dep text; begin
foreach tab in array array['departments','cost_centers','branches','terminals','roles','role_permissions','memberships','membership_roles','membership_departments','tax_settings','economic_activities','audit_events'] loop
mod=case when tab in('roles','role_permissions','memberships','membership_roles','membership_departments') then 'users' when tab in('tax_settings','economic_activities') then 'tax' when tab='audit_events' then 'audit' else 'organization' end;
dep=case when tab='departments' then 'id' when tab='cost_centers' then 'department_id' else 'null::uuid' end;
execute format('alter table public.%I enable row level security',tab);
execute format('grant select on public.%I to authenticated',tab);
-- Membership self-read allows selector without granting all-company organization access.
if tab='memberships' then
execute 'create policy self_membership on public.memberships for select to authenticated using(user_id=auth.uid() and active and private.valid_session())';
end if;
execute format('create policy read_scope on public.%I for select to authenticated using(private.has_access(tenant_id,%L,%s))',tab,mod||'.read',dep);
if tab<>'audit_events' then
execute format('grant insert,update on public.%I to authenticated',tab);
execute format('create policy insert_scope on public.%I for insert to authenticated with check(private.has_access(tenant_id,%L,%s))',tab,mod||'.manage',dep);
execute format('create policy update_scope on public.%I for update to authenticated using(private.has_access(tenant_id,%L,%s)) with check(private.has_access(tenant_id,%L,%s))',tab,mod||'.manage',dep,mod||'.manage',dep);
execute format('create trigger audit_mutation after insert or update or delete on public.%I for each row execute function private.audit_change()',tab);
end if;
end loop;
end $$;
create trigger audit_mutation after update on public.tenants for each row execute function private.audit_change();

-- Membership security mutations lock their tenant to serialize last-admin checks.
create function private.guard_last_admin() returns trigger language plpgsql security definer set search_path='' as $$
declare t uuid; u uuid; admins int;
begin
t=old.tenant_id; u=old.user_id;
perform 1 from public.tenants where id=t for update;
if exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.tenant_id=t and mr.user_id=u and r.code='admin') then
 select count(distinct m.user_id) into admins from public.memberships m join public.membership_roles mr using(tenant_id,user_id) join public.roles r on r.id=mr.role_id where m.tenant_id=t and m.active and r.code='admin' and m.user_id<>u;
 if admins=0 and (TG_OP='DELETE' or (TG_TABLE_NAME='memberships' and (not (to_jsonb(new)->>'active')::boolean or to_jsonb(new)->>'scope'<>'company'))) then raise exception 'Debe permanecer un administrador activo' using errcode='23514'; end if;
end if;
return coalesce(new,old);
end $$;
revoke all on function private.guard_last_admin() from public;
create trigger last_admin before update or delete on public.memberships for each row execute function private.guard_last_admin();
create trigger last_admin before delete on public.membership_roles for each row execute function private.guard_last_admin();
-- Role templates are immutable through Data API; custom roles are managed by backend with transactional checks.
revoke insert,update on public.roles,public.role_permissions,public.membership_roles,public.membership_departments from authenticated;
-- Only backend performs membership mutations after authorization, validation and tenant locking.
revoke insert,update on public.memberships from authenticated;
create index on public.memberships(user_id,tenant_id);
create index on public.audit_events(tenant_id,id desc);
create index on public.departments(tenant_id);
create index on public.cost_centers(tenant_id,department_id);
create index on public.branches(tenant_id);
create index on public.terminals(tenant_id,branch_id);
