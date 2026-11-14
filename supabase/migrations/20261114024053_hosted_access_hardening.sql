-- Supabase-hosted default privileges differ from a clean local PostgreSQL.
-- Normalize only Conta Fácil's own tables; do not touch unrelated objects.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['profiles','tenants','memberships','departments','cost_centers','branches','terminals','permission_catalog','roles','role_permissions','membership_roles','membership_departments','tax_settings','economic_activities','audit_events'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon,authenticated',tab);
 END LOOP;
END $$;
GRANT SELECT ON public.profiles,public.permission_catalog,public.memberships,public.roles,public.role_permissions,public.membership_roles,public.membership_departments,public.audit_events TO authenticated;
GRANT SELECT,UPDATE ON public.tenants TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.departments,public.cost_centers,public.branches,public.terminals,public.tax_settings,public.economic_activities TO authenticated;
REVOKE ALL ON SEQUENCE public.audit_events_id_seq FROM anon,authenticated;

-- Defense in depth for the private schema. Backend policies are included so
-- enabling RLS does not break the trusted API role. End users receive no policy
-- or table grants here; SECURITY DEFINER authorization helpers remain owned by
-- the migration role and continue to check the verified user's identity.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['login_directory','platform_operators','sessions','rate_limits','access_events','invitations'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE private.%I FROM anon,authenticated',tab);
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY server_internal_access ON private.%I FOR ALL TO conta_facil_api USING (true) WITH CHECK (true)',tab);
 END LOOP;
END $$;
REVOKE ALL ON SEQUENCE private.access_events_id_seq FROM anon,authenticated;
NOTIFY pgrst,'reload schema';
