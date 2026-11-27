-- Preserve the custody/workflow opt-in boundaries of the existing role seed.
-- The billing action split must not grant Hacienda or departmental inbox access
-- to accountants or auditors in newly created companies.
create or replace function private.seed_roles()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.roles(tenant_id,code,name) values
 (new.id,'admin','Administrador de empresa'),(new.id,'accountant','Contador'),
 (new.id,'billing','Encargado de facturación'),(new.id,'reception','Encargado de recepción'),
 (new.id,'department','Jefe de departamento'),(new.id,'operative','Usuario operativo'),
 (new.id,'auditor','Auditor de solo lectura');
 insert into public.role_permissions
 select new.id,r.id,p.code from public.roles r cross join public.permission_catalog p
 where r.tenant_id=new.id and (
 r.code='admin'
 or (r.code in('accountant','auditor') and p.action='read'
     and p.module not in('hacienda','collections','payables','document_workflow'))
 or (r.code in('billing','reception','department','operative')
     and p.code in('company.read','organization.read'))
 or (r.code='billing' and p.code in('customers.read','catalog.read','invoices.read',
     'invoices.manage','invoices.create','invoices.edit','invoices.delete')));
 return new;
end $$;
