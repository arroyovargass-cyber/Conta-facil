-- Reuse the protected platform identity. No account or tenant IDs are embedded,
-- no new operators are provisioned, and fiscal data/counters remain untouched.
alter table private.platform_operators add column role_code text not null
 default 'SUPER_ADMIN_GLOBAL' check(role_code='SUPER_ADMIN_GLOBAL');
alter table private.platform_operators enable row level security;
revoke insert,update,delete,truncate on private.platform_operators from public,anon,authenticated,conta_facil_api;
create policy platform_operator_server_read on private.platform_operators
 for select to conta_facil_api using(true);

create function private.audit_platform_operator() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target jsonb;
begin
 target=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details)
 values(null,(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid,
  'PLATFORM_ROLE_'||tg_op,'platform_operators',target->>'user_id',
  jsonb_build_object('role_code',target->>'role_code','database_role',current_user));
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function private.audit_platform_operator() from public,anon,authenticated,conta_facil_api;
create trigger audit_platform_operator after insert or update or delete on private.platform_operators
 for each row execute function private.audit_platform_operator();
insert into public.audit_events(tenant_id,action,entity,entity_id,details)
 select null,'PLATFORM_ROLE_CONFIRMED','platform_operators',user_id::text,
 jsonb_build_object('role_code',role_code,'database_role',current_user)
 from private.platform_operators;

create or replace function private.is_system_administrator() returns boolean
language sql stable security definer set search_path='' as $$
 select private.valid_session()
 and nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2'
 and exists(select 1 from private.platform_operators o
  where o.user_id=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
  and o.role_code='SUPER_ADMIN_GLOBAL');
$$;

create or replace function private.member_access(t uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.valid_session() and private.mfa_satisfied()
 and exists(select 1 from public.tenants tt where tt.id=t and tt.active)
 and (private.is_system_administrator() or exists(select 1 from public.memberships m
  where m.tenant_id=t and m.user_id=auth.uid() and m.active));
$$;

create or replace function private.has_access(t uuid,p text,d uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
select private.valid_session() and private.mfa_satisfied()
and exists(select 1 from public.tenants tt where tt.id=t and tt.active)
and (
 (private.is_system_administrator()
  and exists(select 1 from public.permission_catalog pc where pc.code=p)
  and (d is null or exists(select 1 from public.departments dd where dd.tenant_id=t and dd.id=d)))
 or exists(select 1 from public.memberships m
  where m.tenant_id=t and m.user_id=auth.uid() and m.active
  and exists(select 1 from public.membership_roles mr join public.role_permissions rp
   on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=t and mr.user_id=m.user_id and rp.permission=p)
  and (m.scope='company' or (d is not null and exists(select 1 from public.membership_departments md
   where md.tenant_id=t and md.user_id=m.user_id and md.department_id=d)))
  and (auth.jwt()->>'aal'='aal2' or not exists(select 1 from public.membership_roles mr
   join public.roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id
   where mr.tenant_id=t and mr.user_id=m.user_id and r.code='admin'))
  and ((p not like '%.manage' and p not in('invoices.create','invoices.edit','invoices.delete',
   'invoices.credit_note','invoices.debit_note','invoices.prepare','invoices.email','invoices.numbering'))
   or auth.jwt()->>'aal'='aal2')
  and (p not in('company.manage','users.manage','organization.manage','tax.manage','invoices.numbering',
   'hacienda.credentials.manage','hacienda.connection.test') or private.is_system_administrator()))
);
$$;

create or replace function private.has_catalog_access(t uuid,p text) returns boolean
language sql stable security definer set search_path='' as $$
select private.valid_session() and private.mfa_satisfied()
and (p not like '%.manage' or auth.jwt()->>'aal'='aal2')
and ((private.is_system_administrator() and private.has_access(t,p,null))
 or exists(select 1 from public.memberships m join public.tenants tt on tt.id=m.tenant_id
 join public.membership_roles mr on mr.tenant_id=m.tenant_id and mr.user_id=m.user_id
 join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
 where m.tenant_id=t and m.user_id=auth.uid() and m.active and tt.active and rp.permission=p));
$$;

create or replace function private.hacienda_access(t uuid,p text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.jwt()->>'aal'='aal2' and private.has_access(t,p,null)
 and (private.is_system_administrator() or exists(select 1 from public.memberships m
  where m.tenant_id=t and m.user_id=auth.uid() and m.active and m.scope='company'));
$$;

create or replace function private.workflow_access(t uuid,p text,d uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_access(t,p,d) and (
 private.is_system_administrator()
 or exists(select 1 from public.departments dd where dd.tenant_id=t and dd.id=d and dd.active)
 or exists(select 1 from public.memberships m where m.tenant_id=t and m.user_id=auth.uid() and m.active and m.scope='company'));
$$;

-- Background work rechecks the recorded actor's live authority. It does not
-- invent a browser session or grant cross-company access to ordinary issuers.
create or replace function private.emission_job_document(job uuid,token uuid)
returns setof public.electronic_invoices language sql stable security definer set search_path='' as $$
 select i.* from private.emission_jobs j
 join public.electronic_invoices i on i.tenant_id=j.tenant_id and i.id=j.invoice_id and i.environment=j.environment
 where j.id=job and j.lease_token=token and j.status='leased' and j.lease_until>pg_catalog.now()
 and (
  (j.kind='query' and j.request_origin='automatic' and i.transmission_status in('sent','uncertain','processing'))
  or exists(
   select 1 from private.platform_operators o join public.profiles p on p.id=o.user_id
   join public.tenants t on t.id=i.tenant_id
   where o.user_id=case when j.request_origin='manual' then j.requested_by else coalesce(i.issued_by,i.created_by) end
   and o.role_code='SUPER_ADMIN_GLOBAL' and p.active and t.active
   and (j.kind<>'query' or i.transmission_status in('sent','uncertain','processing')))
  or exists(
   select 1 from public.memberships m join public.profiles p on p.id=m.user_id join public.tenants t on t.id=m.tenant_id
   where m.tenant_id=i.tenant_id and m.user_id=case when j.request_origin='manual' then j.requested_by else coalesce(i.issued_by,i.created_by) end
   and m.active and p.active and t.active
   and exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission=case when j.kind='query' then 'invoices.query' when j.kind='email' and j.request_origin='manual' then 'invoices.email' else 'invoices.emit' end)
   and ((j.kind<>'query' and not(j.kind='email' and j.request_origin='manual')) or exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission='invoices.read'))
   and (m.scope='company' or exists(select 1 from public.membership_departments md where md.tenant_id=m.tenant_id and md.user_id=m.user_id and md.department_id=i.department_id))
   and (j.kind<>'query' or i.transmission_status in('sent','uncertain','processing'))
  )
 );
$$;

notify pgrst,'reload schema';
