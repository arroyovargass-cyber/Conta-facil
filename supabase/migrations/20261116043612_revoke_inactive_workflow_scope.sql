-- Departmental authorization ends when its department is deactivated.
-- Company-wide permission holders retain explicitly authorized historical access.
create function private.workflow_access(t uuid,p text,d uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_access(t,p,d) and (
 exists(select 1 from public.departments dd where dd.tenant_id=t and dd.id=d and dd.active)
 or exists(select 1 from public.memberships m where m.tenant_id=t and m.user_id=auth.uid() and m.active and m.scope='company'));
$$;
revoke all on function private.workflow_access(uuid,text,uuid) from public;
grant execute on function private.workflow_access(uuid,text,uuid) to authenticated,conta_facil_api;
alter policy work_read on public.document_work_items using(private.workflow_access(tenant_id,'collections.read',target_department_id));
alter policy work_insert on public.document_work_items with check(private.has_access(tenant_id,'invoices.manage',source_department_id) and private.has_access(tenant_id,'document_workflow.assign',source_department_id) and created_by=auth.uid());
alter policy work_update on public.document_work_items using(private.workflow_access(tenant_id,'collections.manage',target_department_id)) with check(private.workflow_access(tenant_id,'collections.manage',target_department_id));
create or replace function private.work_source_version(t uuid,wid uuid) returns integer
language sql volatile security definer set search_path='' as $$
 select d.version from public.invoice_drafts d join public.document_work_items w on w.tenant_id=d.tenant_id and w.source_id=d.id
 where w.tenant_id=t and w.id=wid and private.workflow_access(t,'collections.manage',w.target_department_id) for share of d;
$$;
notify pgrst,'reload schema';
