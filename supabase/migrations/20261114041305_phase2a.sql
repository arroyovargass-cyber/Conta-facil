-- Commercial drafts only: no fiscal identifiers or transmission states.
create function private.has_catalog_access(t uuid,p text) returns boolean language sql stable security definer set search_path='' as $$
select private.valid_session() and private.mfa_satisfied()
and (p not like '%.manage' or auth.jwt()->>'aal'='aal2')
and exists(select 1 from public.memberships m join public.tenants tt on tt.id=m.tenant_id
join public.membership_roles mr on mr.tenant_id=m.tenant_id and mr.user_id=m.user_id
join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
where m.tenant_id=t and m.user_id=auth.uid() and m.active and tt.active and rp.permission=p);
$$;
revoke all on function private.has_catalog_access(uuid,text) from public;
grant execute on function private.has_catalog_access(uuid,text) to authenticated;
insert into public.permission_catalog(code,module,action) values
('customers.read','customers','read'),('customers.manage','customers','manage'),
('catalog.read','catalog','read'),('catalog.manage','catalog','manage'),
('invoices.read','invoices','read'),('invoices.manage','invoices','manage');
insert into public.role_permissions(tenant_id,role_id,permission)
select r.tenant_id,r.id,p.code from public.roles r cross join public.permission_catalog p
where p.module in ('customers','catalog','invoices') and
(r.code='admin' or (r.code in ('accountant','auditor') and p.action='read') or
(r.code='billing' and (p.action='read' or p.code='invoices.manage'))) on conflict do nothing;
create or replace function private.seed_roles() returns trigger language plpgsql security definer set search_path='' as $$
begin
insert into public.roles(tenant_id,code,name) values(new.id,'admin','Administrador de empresa'),(new.id,'accountant','Contador'),(new.id,'billing','Encargado de facturación'),(new.id,'reception','Encargado de recepción'),(new.id,'department','Jefe de departamento'),(new.id,'operative','Usuario operativo'),(new.id,'auditor','Auditor de solo lectura');
insert into public.role_permissions select new.id,r.id,p.code from public.roles r cross join public.permission_catalog p where r.tenant_id=new.id and
(r.code='admin' or (r.code in('accountant','auditor') and p.action='read') or
(r.code in('billing','reception','department','operative') and p.code in('company.read','organization.read')) or
(r.code='billing' and (p.code in('customers.read','catalog.read','invoices.read','invoices.manage'))));
return new;
end $$;
create table public.customers(
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 name text not null check(length(trim(name)) between 1 and 160),
 identification_type text not null default '' check(length(identification_type)<=40),
 identification text not null default '' check(length(identification)<=40),
 email text not null default '' check(length(email)<=254),phone text not null default '' check(length(phone)<=40),
 address text not null default '' check(length(address)<=1000),active boolean not null default true,
 version integer not null default 1 check(version>0), created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),check((identification_type='')=(identification=''))
);
create table public.catalog_items(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,
 code text not null check(length(trim(code)) between 1 and 60),description text not null check(length(trim(description)) between 1 and 160),
 kind text not null check(kind in('product','service')),currency text not null check(currency in('CRC','USD')),
 unit_price numeric(14,5) not null check(unit_price>=0),cabys text not null default '' check(length(cabys)<=40),unit text not null default '' check(length(unit)<=40),
 active boolean not null default true,version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,code)
);
create table public.invoice_drafts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,
 customer_id uuid not null,department_id uuid not null,currency text not null check(currency in('CRC','USD')),
 customer_snapshot jsonb not null check(jsonb_typeof(customer_snapshot)='object' and octet_length(customer_snapshot::text)<=4096),notes text not null default '' check(length(notes)<=2000),
 status text not null default 'draft' check(status='draft'),archived_at timestamptz,
 version integer not null default 1 check(version>0),created_by uuid not null references public.profiles,updated_by uuid not null references public.profiles,
 operation_id uuid not null,request_hash text not null check(length(request_hash)<=64),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,created_by,operation_id),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),
 foreign key(tenant_id,department_id) references public.departments(tenant_id,id)
);
create table public.invoice_draft_lines(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,draft_id uuid not null,
 position integer not null check(position between 1 and 100),catalog_item_id uuid,
 description text not null check(length(trim(description)) between 1 and 160),quantity numeric(14,5) not null check(quantity>0),unit_price numeric(14,5) not null check(unit_price>=0),
 created_at timestamptz not null default now(),unique(tenant_id,draft_id,position),
 foreign key(tenant_id,draft_id) references public.invoice_drafts(tenant_id,id),
 foreign key(tenant_id,catalog_item_id) references public.catalog_items(tenant_id,id)
);
create index customers_list on public.customers(tenant_id,name,id);
create index catalog_list on public.catalog_items(tenant_id,description,id);
create index drafts_list on public.invoice_drafts(tenant_id,department_id,created_at desc,id);
create index drafts_customer on public.invoice_drafts(tenant_id,customer_id);
create index lines_catalog on public.invoice_draft_lines(tenant_id,catalog_item_id);
DO $$ declare tab text; perm text; begin
foreach tab in array array['customers','catalog_items','invoice_drafts','invoice_draft_lines'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from public,anon,authenticated',tab);
 execute format('grant select,insert,update on public.%I to authenticated',tab);
 execute format('create policy required_mfa on public.%I as restrictive for all to authenticated using(private.mfa_satisfied()) with check(private.mfa_satisfied())',tab);
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',tab);
end loop;
foreach tab in array array['customers','catalog_items'] loop
 perm=case when tab='customers' then 'customers' else 'catalog' end;
 execute format('create policy read_scope on public.%I for select to authenticated using(private.has_catalog_access(tenant_id,%L))',tab,perm||'.read');
 execute format('create policy insert_scope on public.%I for insert to authenticated with check(private.has_catalog_access(tenant_id,%L))',tab,perm||'.manage');
 execute format('create policy update_scope on public.%I for update to authenticated using(private.has_catalog_access(tenant_id,%L)) with check(private.has_catalog_access(tenant_id,%L))',tab,perm||'.manage',perm||'.manage');
end loop;
end $$;
create policy read_scope on public.invoice_drafts for select to authenticated using(private.has_access(tenant_id,'invoices.read',department_id));
create policy insert_scope on public.invoice_drafts for insert to authenticated with check(private.has_access(tenant_id,'invoices.manage',department_id) and created_by=auth.uid() and updated_by=auth.uid());
create policy update_scope on public.invoice_drafts for update to authenticated using(private.has_access(tenant_id,'invoices.manage',department_id)) with check(private.has_access(tenant_id,'invoices.manage',department_id) and updated_by=auth.uid());
create policy read_scope on public.invoice_draft_lines for select to authenticated using(exists(select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and private.has_access(d.tenant_id,'invoices.read',d.department_id)));
create policy insert_scope on public.invoice_draft_lines for insert to authenticated with check(exists(select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null and private.has_access(d.tenant_id,'invoices.manage',d.department_id)));
create policy update_scope on public.invoice_draft_lines for update to authenticated using(exists(select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null and private.has_access(d.tenant_id,'invoices.manage',d.department_id))) with check(exists(select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null and private.has_access(d.tenant_id,'invoices.manage',d.department_id)));
grant delete on public.invoice_draft_lines to authenticated;
create policy delete_scope on public.invoice_draft_lines for delete to authenticated using(exists(select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null and private.has_access(d.tenant_id,'invoices.manage',d.department_id)));
notify pgrst,'reload schema';
