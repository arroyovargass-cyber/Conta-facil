-- Only invoice policies change. Supabase's managed auth schema is not grantable
-- by postgres; use the verified API's transaction-local claims directly instead.
-- Tenant/department permission, actor, MFA and state predicates stay mandatory.
-- No new functions, role grants, Auth table access or RLS bypass.
alter policy invoice_prepare on public.electronic_invoices with check(
 private.has_access(tenant_id,'invoices.manage',department_id)
 and created_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
 and document_status='prepared' and signature_status='pending' and transmission_status='not_sent'
 and hacienda_status='pending' and email_status='not_queued');
alter policy invoice_issue on public.electronic_invoices
 using(private.has_access(tenant_id,'invoices.emit',department_id)
 and nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2')
 with check(private.has_access(tenant_id,'invoices.emit',department_id)
 and nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2');

-- Preserve the existing invoice immutability/issuance guard with the same claim source.
create or replace function private.guard_issued_invoice() returns trigger language plpgsql set search_path='' as $$
begin
 if old.document_status='issued' and row(new.snapshot,new.options,new.tenant_id,new.department_id,new.document_status,
  new.environment,new.document_type,new.draft_id,new.clave,new.consecutivo,new.issued_at,new.credential_version,
  new.certificate_fingerprint,new.issue_operation_id,new.issued_by,new.response_trust_policy)
 is distinct from row(old.snapshot,old.options,old.tenant_id,old.department_id,old.document_status,
  old.environment,old.document_type,old.draft_id,old.clave,old.consecutivo,old.issued_at,old.credential_version,
  old.certificate_fingerprint,old.issue_operation_id,old.issued_by,old.response_trust_policy) then
  raise exception 'ISSUED_INVOICE_IMMUTABLE';
 end if;
 if new.response_trust_policy is distinct from old.response_trust_policy and current_user='conta_facil_api'
  and not coalesce(private.has_access(new.tenant_id,'invoices.emit',new.department_id) and nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2',false) then
  raise exception 'FORBIDDEN';
 end if;
 return new;
end $$;
revoke all on function private.guard_issued_invoice() from public,anon,authenticated;
