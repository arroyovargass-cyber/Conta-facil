-- Internal backend role, initially unable to log in. Set its random password only
-- through a protected provisioning channel, never in source or migration history.
DO $$ BEGIN
 IF NOT EXISTS(select 1 from pg_roles where rolname='conta_facil_api') THEN
  CREATE ROLE conta_facil_api NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
END $$;
GRANT authenticated TO conta_facil_api WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public,private,auth TO conta_facil_api;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt(),private.valid_session(),private.has_access(uuid,text,uuid),private.member_access(uuid),private.mfa_satisfied() TO conta_facil_api;
GRANT SELECT,INSERT,UPDATE ON public.tenants,public.memberships,public.departments,public.cost_centers,public.branches,public.terminals,public.tax_settings,public.economic_activities TO conta_facil_api;
GRANT SELECT,INSERT ON public.profiles,public.roles,public.role_permissions TO conta_facil_api;
GRANT SELECT,INSERT,DELETE ON public.membership_roles,public.membership_departments TO conta_facil_api;
GRANT SELECT ON public.permission_catalog TO conta_facil_api;
GRANT SELECT,INSERT ON public.audit_events TO conta_facil_api;
GRANT SELECT,INSERT ON private.login_directory TO conta_facil_api;
GRANT SELECT ON private.platform_operators TO conta_facil_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.sessions,private.rate_limits,private.invitations TO conta_facil_api;
GRANT SELECT,INSERT ON private.access_events TO conta_facil_api;
GRANT USAGE ON SEQUENCE public.audit_events_id_seq,private.access_events_id_seq TO conta_facil_api;
-- This policy is exclusively for the trusted server role. End-user roles do not
-- inherit it. The API's ordinary data paths SET LOCAL ROLE authenticated, so they
-- continue to run all tenant/department/MFA policies instead of these policies.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['profiles','permission_catalog','tenants','memberships','departments','cost_centers','branches','terminals','roles','role_permissions','membership_roles','membership_departments','tax_settings','economic_activities','audit_events'] LOOP
  EXECUTE format('CREATE POLICY server_internal_access ON public.%I FOR ALL TO conta_facil_api USING (true) WITH CHECK (true)',tab);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
