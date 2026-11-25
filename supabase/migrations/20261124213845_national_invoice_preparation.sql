-- Additive FE preparation. No backfill or presumed tax/status on historical drafts.
insert into public.permission_catalog(code,module,action) values('invoices.emit','invoices','emit') on conflict do nothing;
-- Existing admins retain intended operational authority; other roles require explicit grant.
insert into public.role_permissions(tenant_id,role_id,permission)
 select tenant_id,id,'invoices.emit' from public.roles where code='admin' on conflict do nothing;
create table public.electronic_invoices(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,
 draft_id uuid not null,draft_version integer not null check(draft_version>0),department_id uuid not null,
 environment text not null default 'test' check(environment='test'),document_type text not null default 'FE' check(document_type='FE'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=524288),
 options jsonb not null check(jsonb_typeof(options)='object' and octet_length(options::text)<=16384),
 document_status text not null default 'prepared' check(document_status in('prepared','issued')),
 signature_status text not null default 'pending' check(signature_status in('pending','signed')),
 transmission_status text not null default 'not_sent' check(transmission_status in('not_sent','queued','sent','uncertain','processing','technical_error')),
 hacienda_status text not null default 'pending' check(hacienda_status in('pending','accepted','rejected')),
 email_status text not null default 'not_queued' check(email_status in('not_queued','queued','processing','provider_accepted','uncertain','error')),
 version integer not null default 1 check(version>0),created_by uuid not null references public.profiles,
 operation_id uuid not null,request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),unique(tenant_id,id),unique(tenant_id,draft_id),unique(tenant_id,created_by,operation_id),
 foreign key(tenant_id,draft_id) references public.invoice_drafts(tenant_id,id),
 foreign key(tenant_id,department_id) references public.departments(tenant_id,id)
);
create index electronic_invoices_list on public.electronic_invoices(tenant_id,department_id,created_at desc,id);
alter table public.electronic_invoices enable row level security;
revoke all on public.electronic_invoices from public,anon,authenticated;
grant select on public.electronic_invoices to authenticated;
grant select,insert on public.electronic_invoices to conta_facil_api;
create policy invoice_read on public.electronic_invoices for select to authenticated,conta_facil_api using(private.has_access(tenant_id,'invoices.read',department_id));
create policy invoice_prepare on public.electronic_invoices for insert to conta_facil_api with check(
 private.has_access(tenant_id,'invoices.manage',department_id) and created_by=auth.uid()
 and document_status='prepared' and signature_status='pending' and transmission_status='not_sent' and hacienda_status='pending' and email_status='not_queued');
notify pgrst,'reload schema';
