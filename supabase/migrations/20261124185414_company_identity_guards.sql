-- All interactive company edits must use the versioned server endpoint.
revoke update on public.tenants from authenticated;
-- Preserve old duplicate records unchanged; prevent introducing new normalized duplicates.
create function private.company_identification_key(kind text,value text) returns text language sql immutable set search_path='' as $$
 select (case kind when 'national' then '01' when 'legal' then '02' when 'dimex' then '03' when 'nite' then '04' else kind end)||':'||lower(regexp_replace(value,'[-[:space:]]','','g'));
$$;
revoke all on function private.company_identification_key(text,text) from public;
grant execute on function private.company_identification_key(text,text) to conta_facil_api,authenticated;
create function private.guard_company_identification() returns trigger language plpgsql set search_path='' as $$
declare canonical text;
begin
 canonical=private.company_identification_key(new.identification_type,new.identification);
 if tg_op='UPDATE' then
  if canonical=private.company_identification_key(old.identification_type,old.identification) then return new; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('company-id:'||canonical,0));
 if exists(select 1 from public.tenants t where t.id<>new.id and private.company_identification_key(t.identification_type,t.identification)=canonical) then
  raise exception using errcode='23505',message='Ya existe una empresa con esa identificación';
 end if;
 return new;
end $$;
revoke all on function private.guard_company_identification() from public;
create trigger company_identification_guard before insert or update of identification,identification_type on public.tenants for each row execute function private.guard_company_identification();
notify pgrst,'reload schema';
