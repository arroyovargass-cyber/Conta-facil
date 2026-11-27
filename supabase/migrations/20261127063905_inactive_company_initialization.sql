-- New companies can start inactive. Only a valid platform owner may insert
-- empty setup records in that state; existing read/update/credential gates and
-- all fiscal prerequisites remain unchanged.
create policy hacienda_empty_company_setup on public.hacienda_configuration
 for insert to conta_facil_api with check(
 private.is_system_administrator() and revision=0 and active_version is null
 and certificate_metadata is null and api_status='not_tested'
 and api_checked_at is null and session_closed is null);

create policy route_disabled_company_setup on public.document_routes
 for insert to conta_facil_api with check(
 private.is_system_administrator() and not enabled and assignee_id is null and version=1);

notify pgrst,'reload schema';
