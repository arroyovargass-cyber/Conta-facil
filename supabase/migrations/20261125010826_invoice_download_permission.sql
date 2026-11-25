insert into public.permission_catalog(code,module,action) values('invoices.download','invoices','download') on conflict do nothing;
insert into public.role_permissions(tenant_id,role_id,permission) select tenant_id,id,'invoices.download' from public.roles where code='admin' on conflict do nothing;
