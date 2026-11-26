-- Repair hosted ACL drift. The NOINHERIT server role evaluates auth.uid()/jwt()
-- in invoice RLS after RESET ROLE; EXECUTE alone cannot resolve schema objects.
-- This grants neither Auth table access nor CREATE, inheritance or RLS bypass.
grant usage on schema auth to conta_facil_api;
grant execute on function auth.uid(), auth.jwt() to conta_facil_api;
