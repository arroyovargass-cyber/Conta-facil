-- The restricted backend installs verified claims transaction-locally. Resolve
-- the actor without entering Supabase's managed Auth schema. No role grants,
-- RLS changes, data backfill, or SECURITY DEFINER privileges are introduced.
create or replace function private.company_version()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.configuration_version=old.configuration_version+1;
 new.updated_at=pg_catalog.now();
 new.updated_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
 return new;
end $$;
