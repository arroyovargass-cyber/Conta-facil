-- Restoring an archive is explicit; it cannot also change commercial contents.
create function private.guard_archived_draft() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.archived_at is not null and
  (to_jsonb(new)-array['archived_at','version','updated_by','updated_at']) is distinct from
  (to_jsonb(old)-array['archived_at','version','updated_by','updated_at']) then
  raise exception 'Restore the draft before editing its commercial fields' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.guard_archived_draft() from public;
create trigger guard_archived_draft before update on public.invoice_drafts
for each row execute function private.guard_archived_draft();
notify pgrst,'reload schema';
