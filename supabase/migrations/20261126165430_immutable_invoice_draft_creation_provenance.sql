-- xmin changes on UPDATE, so it cannot prove that the parent draft was inserted
-- in the current transaction. Keep old provenance unknown; do not infer or
-- backfill a historical insertion transaction.
alter table public.invoice_drafts add column creation_xid xid8;

create function private.guard_invoice_draft_creation_provenance() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  -- A supplied client value is always replaced with database provenance.
  new.creation_xid=pg_catalog.pg_current_xact_id();
 elsif new.creation_xid is distinct from old.creation_xid then
  raise exception 'DRAFT_CREATION_PROVENANCE_IMMUTABLE' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_invoice_draft_creation_provenance() from public,anon,authenticated,conta_facil_api;
create trigger guard_invoice_draft_creation_provenance before insert or update on public.invoice_drafts
for each row execute function private.guard_invoice_draft_creation_provenance();

-- Only an actual insertion in this transaction permits create-only initial
-- lines. Later updates, including archive/restore, cannot regain that ability.
-- A historical NULL never satisfies this branch and therefore requires edit.
alter policy insert_scope on public.invoice_draft_lines with check(exists(
 select 1 from public.invoice_drafts d
 where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null
 and (private.has_access(d.tenant_id,'invoices.edit',d.department_id) or
  (private.has_access(d.tenant_id,'invoices.create',d.department_id)
   and d.creation_xid=pg_catalog.pg_current_xact_id()
   and d.created_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid))));

notify pgrst,'reload schema';
