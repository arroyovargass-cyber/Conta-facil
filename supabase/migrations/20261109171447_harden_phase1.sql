-- Selector access respects active membership and administrative MFA, including direct Data API.
create function private.member_access(t uuid) returns boolean language sql stable security definer set search_path='' as $$
select private.valid_session() and exists(select 1 from public.memberships m join public.tenants tt on tt.id=m.tenant_id where m.tenant_id=t and m.user_id=auth.uid() and m.active and tt.active)
and (auth.jwt()->>'aal'='aal2' or (not exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id join public.memberships m on m.tenant_id=mr.tenant_id and m.user_id=mr.user_id where mr.user_id=auth.uid() and m.active and r.code='admin') and not exists(select 1 from private.platform_operators where user_id=auth.uid())));
$$;
revoke all on function private.member_access(uuid) from public;
grant execute on function private.member_access(uuid) to authenticated;
drop policy company_read on public.tenants;
create policy company_read on public.tenants for select to authenticated using(private.member_access(id));
drop policy self_membership on public.memberships;
create policy self_membership on public.memberships for select to authenticated using(user_id=auth.uid() and private.member_access(tenant_id));
-- Direct permission checks also enforce globally required MFA.
create function private.mfa_satisfied() returns boolean language sql stable security definer set search_path='' as $$
select auth.jwt()->>'aal'='aal2' or (not exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id join public.memberships m on m.tenant_id=mr.tenant_id and m.user_id=mr.user_id where mr.user_id=auth.uid() and m.active and r.code='admin') and not exists(select 1 from private.platform_operators where user_id=auth.uid()));
$$;
revoke all on function private.mfa_satisfied() from public;
grant execute on function private.mfa_satisfied() to authenticated;
-- Restrictive policy augments all permissive policies, preventing MFA bypass with alternate roles.
DO $$ declare tab text; begin foreach tab in array array['tenants','departments','cost_centers','branches','terminals','roles','role_permissions','memberships','membership_roles','membership_departments','tax_settings','economic_activities','audit_events'] loop
execute format('create policy required_mfa on public.%I as restrictive for all to authenticated using(private.mfa_satisfied()) with check(private.mfa_satisfied())',tab);
end loop; end $$;
notify pgrst,'reload schema';
