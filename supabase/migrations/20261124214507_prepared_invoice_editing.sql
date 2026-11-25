-- Only the server can refresh a prepared copy. Issued copies stay immutable.
grant update(snapshot,options,draft_version,version) on public.electronic_invoices to conta_facil_api;
create policy invoice_refresh on public.electronic_invoices for update to conta_facil_api
 using(document_status='prepared' and transmission_status='not_sent' and private.has_access(tenant_id,'invoices.manage',department_id))
 with check(document_status='prepared' and transmission_status='not_sent' and private.has_access(tenant_id,'invoices.manage',department_id));
