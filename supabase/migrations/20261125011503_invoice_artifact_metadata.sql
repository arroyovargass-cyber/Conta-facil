-- Returns only artifact kinds, never bytes or a private storage address.
create function private.invoice_artifact_kinds(t uuid,i uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct a.kind order by a.kind),'{}'::text[]) from private.invoice_artifacts a
 join public.electronic_invoices d on d.tenant_id=a.tenant_id and d.id=a.invoice_id
 where d.tenant_id=t and d.id=i and private.has_access(t,'invoices.read',d.department_id)
 and private.has_access(t,'invoices.download',d.department_id);
$$;
revoke all on function private.invoice_artifact_kinds(uuid,uuid) from public,anon;
grant execute on function private.invoice_artifact_kinds(uuid,uuid) to authenticated,conta_facil_api;
