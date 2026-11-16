-- Minimal idempotency confirmation for an authorized origin actor. Does not grant inbox reads.
create function private.work_assignment_id(t uuid,s uuid) returns uuid language sql stable security definer set search_path='' as $$
 select w.id from public.document_work_items w join public.invoice_drafts d on d.tenant_id=w.tenant_id and d.id=w.source_id
 where w.tenant_id=t and w.source_id=s and w.flow='collections'
 and private.has_access(t,'invoices.manage',d.department_id) and private.has_access(t,'document_workflow.assign',d.department_id);
$$;
revoke all on function private.work_assignment_id(uuid,uuid) from public,anon,authenticated;
grant execute on function private.work_assignment_id(uuid,uuid) to conta_facil_api;
