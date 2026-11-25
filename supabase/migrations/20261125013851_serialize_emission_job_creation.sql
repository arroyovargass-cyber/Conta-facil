create index electronic_invoices_waiting_hacienda on public.electronic_invoices(id)
 where hacienda_status='pending' and transmission_status in('uncertain','sent','processing');
-- Job creation, including the absent-row case, shares a canonical key with the
-- pipeline and manual actions. No second transmission is ever recovered here.
create or replace function private.recover_uncertain_emissions() returns integer language plpgsql security definer set search_path='' as $$
declare d record; count_rows integer:=0; inserted integer;
begin
 for d in
  select i.tenant_id,i.id from public.electronic_invoices i
  where i.transmission_status in('uncertain','sent','processing') and i.hacienda_status='pending'
  and not exists(select 1 from private.emission_jobs q where q.tenant_id=i.tenant_id and q.invoice_id=i.id and q.kind='query')
  and exists(select 1 from private.emission_jobs j where j.tenant_id=i.tenant_id and j.invoice_id=i.id and j.kind='transmit'
    and (j.status in('uncertain','completed','failed') or (j.status='leased' and j.lease_until<=now())))
  order by i.id limit 100
 loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(d.tenant_id::text||':'||d.id::text||':query',0));
  insert into private.emission_jobs(tenant_id,invoice_id,kind) values(d.tenant_id,d.id,'query')
  on conflict(tenant_id,invoice_id,kind) do nothing;
  get diagnostics inserted=row_count;count_rows=count_rows+inserted;
 end loop;
 return count_rows;
end $$;
revoke all on function private.recover_uncertain_emissions() from public,anon,authenticated;
grant execute on function private.recover_uncertain_emissions() to conta_facil_api;
