-- Evaluate request-wide authorization once per SQL statement, not once per
-- company. The decision still validates session, profile, role and MFA and is
-- never cached across statements or users. Ordinary membership RLS is retained.
alter policy company_read on public.tenants using(
 ((select private.is_system_administrator()) and active)
 or private.member_access(id));
alter policy required_mfa on public.tenants
 using((select private.mfa_satisfied()))
 with check((select private.mfa_satisfied()));

notify pgrst,'reload schema';
