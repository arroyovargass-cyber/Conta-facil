-- Internal minimal projections. No SELECT grant on source drafts is added.
create function private.assignment_source(t uuid,s uuid)
returns table(id uuid,department_id uuid,version integer,archived_at timestamptz,customer_name text)
language sql volatile security definer set search_path='' as $$
 select d.id,d.department_id,d.version,d.archived_at,d.customer_snapshot->>'name'
 from public.invoice_drafts d where d.tenant_id=t and d.id=s
 and private.has_access(t,'invoices.manage',d.department_id)
 and private.has_access(t,'document_workflow.assign',d.department_id) for share of d;
$$;
create function private.collection_route(t uuid,s uuid)
returns table(target_department_id uuid,assignee_id uuid,enabled boolean)
language sql volatile security definer set search_path='' as $$
 select r.target_department_id,r.assignee_id,r.enabled from public.document_routes r
 where r.tenant_id=t and r.flow='collections'
 and exists(select 1 from public.invoice_drafts d where d.tenant_id=t and d.id=s
 and private.has_access(t,'invoices.manage',d.department_id) and private.has_access(t,'document_workflow.assign',d.department_id)) for share of r;
$$;
create function private.work_source_version(t uuid,wid uuid) returns integer
language sql volatile security definer set search_path='' as $$
 select d.version from public.invoice_drafts d join public.document_work_items w on w.tenant_id=d.tenant_id and w.source_id=d.id
 where w.tenant_id=t and w.id=wid and private.has_access(t,'collections.manage',w.target_department_id) for share of d;
$$;
revoke all on function private.assignment_source(uuid,uuid),private.collection_route(uuid,uuid),private.work_source_version(uuid,uuid) from public,anon,authenticated;
grant execute on function private.assignment_source(uuid,uuid),private.collection_route(uuid,uuid),private.work_source_version(uuid,uuid) to conta_facil_api;
