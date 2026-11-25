-- Recover only consultations for an external effect with an uncertain/completed
-- network boundary. Never schedule a second transmission automatically.
create function private.recover_uncertain_emissions() returns integer language plpgsql security definer set search_path='' as $$
declare count_rows integer;
begin
 insert into private.emission_jobs(tenant_id,invoice_id,kind)
 select i.tenant_id,i.id,'query' from public.electronic_invoices i
 where i.transmission_status in('uncertain','sent','processing') and i.hacienda_status='pending'
 and exists(select 1 from private.emission_jobs j where j.tenant_id=i.tenant_id and j.invoice_id=i.id and j.kind='transmit'
 and (j.status in('uncertain','completed','failed') or (j.status='leased' and j.lease_until<=now())))
 on conflict(tenant_id,invoice_id,kind) do nothing;
 get diagnostics count_rows=row_count;return count_rows;
end $$;
revoke all on function private.recover_uncertain_emissions() from public,anon,authenticated;
grant execute on function private.recover_uncertain_emissions() to conta_facil_api;
