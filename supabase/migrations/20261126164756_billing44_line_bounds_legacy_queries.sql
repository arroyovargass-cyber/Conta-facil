-- The draft request is still capped at 256KiB and a prepared snapshot at
-- 512KiB. Allow the official per-line VIN/special-field cardinalities inside
-- those existing aggregate limits instead of an obsolete 16KiB line limit.
alter table public.invoice_draft_lines
 drop constraint invoice_draft_lines_fiscal_check,
 add constraint invoice_draft_lines_fiscal_check check(
  fiscal is null or (jsonb_typeof(fiscal)='object' and octet_length(fiscal::text)<=262144));

-- Conservatively classify historical query jobs only when an actual manual
-- action was recorded. Action-free automatic reconciliation keeps its existing
-- evidence-only capability; no document, number, snapshot or state is changed.
with latest_manual_queries as (
 select distinct on(a.tenant_id,a.invoice_id) a.tenant_id,a.invoice_id,a.actor_id
 from private.emission_actions a where a.action='query'
 order by a.tenant_id,a.invoice_id,a.created_at desc,a.operation_id desc
)
update private.emission_jobs j set request_origin='manual',requested_by=a.actor_id
from latest_manual_queries a
where j.tenant_id=a.tenant_id and j.invoice_id=a.invoice_id and j.kind='query'
 and j.request_origin='automatic';

notify pgrst,'reload schema';
