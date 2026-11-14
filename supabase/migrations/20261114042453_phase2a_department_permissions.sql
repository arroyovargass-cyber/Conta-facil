-- Invoice readers need authorized department names even without organization.read.
-- The existing restrictive MFA policy continues to apply.
create policy invoice_department_read on public.departments for select to authenticated
using(private.has_access(tenant_id,'invoices.read',id));
notify pgrst,'reload schema';
