-- Additive draft preparation. Existing records keep NULL fiscal treatment/totals.
alter table public.customers
 add column trade_name text not null default '' check(length(trade_name)<=160),
 add column economic_activity text not null default '' check(length(economic_activity)<=20),
 add column province text not null default '' check(length(province)<=10),
 add column canton text not null default '' check(length(canton)<=10),
 add column district text not null default '' check(length(district)<=10),
 add column neighborhood text not null default '' check(length(neighborhood)<=160),
 add column exoneration jsonb check(exoneration is null or (jsonb_typeof(exoneration)='object' and octet_length(exoneration::text)<=8192));
alter table public.catalog_items add column tax_defaults jsonb
 check(tax_defaults is null or (jsonb_typeof(tax_defaults)='object' and octet_length(tax_defaults::text)<=16384));
alter table public.invoice_drafts
 alter column customer_id drop not null,
 add column receiver_mode text not null default 'registered' check(receiver_mode in ('registered','occasional')),
 add column document_type text not null default 'FE' check(document_type in ('FE','TE')),
 add column fiscal_totals jsonb check(fiscal_totals is null or (jsonb_typeof(fiscal_totals)='object' and octet_length(fiscal_totals::text)<=131072)),
 add column calculation_version text;
alter table public.invoice_drafts drop constraint invoice_drafts_customer_snapshot_check;
alter table public.invoice_drafts add constraint invoice_drafts_customer_snapshot_check check(jsonb_typeof(customer_snapshot)='object' and octet_length(customer_snapshot::text)<=16384);
alter table public.invoice_draft_lines
 alter column quantity drop not null,
 alter column unit_price drop not null,
 add column fiscal jsonb check(fiscal is null or (jsonb_typeof(fiscal)='object' and octet_length(fiscal::text)<=16384));
alter table public.invoice_draft_lines drop constraint invoice_draft_lines_description_check;
alter table public.invoice_draft_lines add constraint invoice_draft_lines_description_check check(length(description)<=160);
create index customers_identification_lookup on public.customers(tenant_id,identification_type,identification) where identification<>'';
notify pgrst,'reload schema';
