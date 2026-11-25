-- State audit deliberately excludes XML, fiscal snapshots, recipients and secrets.
create function private.audit_invoice_state() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details)
 values(new.tenant_id,auth.uid(),case when tg_op='INSERT' then 'INVOICE_PREPARED' else 'INVOICE_UPDATED' end,'electronic_invoices',new.id::text,
 jsonb_build_object('version',new.version,'document_status',new.document_status,'signature_status',new.signature_status,
 'transmission_status',new.transmission_status,'hacienda_status',new.hacienda_status,'email_status',new.email_status,'issued_by',new.issued_by));
 return new;
end $$;
revoke all on function private.audit_invoice_state() from public,anon,authenticated;
create trigger invoice_state_audit after insert or update on public.electronic_invoices for each row execute function private.audit_invoice_state();
