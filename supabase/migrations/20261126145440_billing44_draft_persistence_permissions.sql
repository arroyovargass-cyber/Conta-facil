-- Incremental commercial fields. Historical drafts/preparations keep their data.
alter table public.customers add column phone_country_code text not null default '' check(length(phone_country_code)<=3);
alter table public.invoice_drafts
 add column commercial jsonb not null default '{}' check(jsonb_typeof(commercial)='object' and octet_length(commercial::text)<=16384),
 add column other_charges jsonb not null default '[]' check(jsonb_typeof(other_charges)='array' and jsonb_array_length(other_charges)<=15 and octet_length(other_charges::text)<=65536),
 drop constraint invoice_drafts_receiver_mode_check,
 add constraint invoice_drafts_receiver_mode_check check(receiver_mode in('registered','occasional','consumer_final')),
 add constraint invoice_drafts_consumer_final_check check(receiver_mode<>'consumer_final' or (document_type='TE' and customer_id is null));
alter table public.electronic_invoices
 drop constraint electronic_invoices_document_type_check,
 add constraint electronic_invoices_document_type_check check(document_type in('FE','TE'));

insert into public.permission_catalog(code,module,action) values
 ('invoices.create','invoices','create'),('invoices.edit','invoices','edit'),
 ('invoices.delete','invoices','delete'),('invoices.query','invoices','query'),
 ('invoices.credit_note','invoices','credit_note'),('invoices.debit_note','invoices','debit_note')
on conflict do nothing;
-- One explicit migration of existing authority. Legacy manage never implies a
-- new action at runtime, and membership/department assignments do not change.
insert into public.role_permissions(tenant_id,role_id,permission)
 select rp.tenant_id,rp.role_id,p.permission from public.role_permissions rp
 cross join (values('invoices.create'),('invoices.edit'),('invoices.delete')) p(permission)
 where rp.permission='invoices.manage' on conflict do nothing;
insert into public.role_permissions(tenant_id,role_id,permission)
 select tenant_id,role_id,'invoices.query' from public.role_permissions where permission='invoices.emit' on conflict do nothing;
insert into public.role_permissions(tenant_id,role_id,permission)
 select r.tenant_id,r.id,p.code from public.roles r cross join public.permission_catalog p
 where r.code='admin' and p.module='invoices' on conflict do nothing;

-- Keep the prior AAL2 requirement when the old manage action is split. This is
-- the existing live-session/tenant/department authorization function, unchanged
-- except for the explicit write-action MFA gate and direct claim source.
create or replace function private.has_access(t uuid,p text,d uuid default null) returns boolean language sql stable security definer set search_path='' as $$
select private.valid_session() and exists(select 1 from public.memberships m join public.tenants tnt on tnt.id=m.tenant_id
where m.tenant_id=t and m.user_id=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and m.active and tnt.active
and exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=t and mr.user_id=m.user_id and rp.permission=p)
and (m.scope='company' or (d is not null and exists(select 1 from public.membership_departments md where md.tenant_id=t and md.user_id=m.user_id and md.department_id=d)))
and (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2' or not exists(select 1 from public.membership_roles mr join public.roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id where mr.tenant_id=t and mr.user_id=m.user_id and r.code='admin'))
and ((p not like '%.manage' and p not in('invoices.create','invoices.edit','invoices.delete','invoices.credit_note','invoices.debit_note')) or nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2')
and (p not in('company.manage','users.manage','organization.manage','tax.manage','hacienda.credentials.manage','hacienda.connection.test') or private.is_system_administrator()));
$$;

-- The administrator seed already grants the whole permission catalog. Billing
-- keeps its explicit draft-authoring authority for companies created later.
create or replace function private.seed_roles() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.roles(tenant_id,code,name) values(new.id,'admin','Administrador de empresa'),(new.id,'accountant','Contador'),(new.id,'billing','Encargado de facturación'),(new.id,'reception','Encargado de recepción'),(new.id,'department','Jefe de departamento'),(new.id,'operative','Usuario operativo'),(new.id,'auditor','Auditor de solo lectura');
 insert into public.role_permissions select new.id,r.id,p.code from public.roles r cross join public.permission_catalog p where r.tenant_id=new.id and
 (r.code='admin' or (r.code in('accountant','auditor') and p.action='read') or
 (r.code in('billing','reception','department','operative') and p.code in('company.read','organization.read')) or
 (r.code='billing' and p.code in('customers.read','catalog.read','invoices.read','invoices.manage','invoices.create','invoices.edit','invoices.delete')));
 return new;
end $$;

alter policy insert_scope on public.invoice_drafts with check(
 private.has_access(tenant_id,'invoices.create',department_id)
 and created_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
 and updated_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
alter policy update_scope on public.invoice_drafts
 using(private.has_access(tenant_id,'invoices.edit',department_id) or private.has_access(tenant_id,'invoices.delete',department_id))
 with check((private.has_access(tenant_id,'invoices.edit',department_id) or private.has_access(tenant_id,'invoices.delete',department_id))
 and updated_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);

-- RLS checks old/new scope; this invoker trigger distinguishes archive from
-- content updates, preventing a delete-only actor from editing retained data.
create function private.guard_invoice_draft_actions() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in('authenticated','conta_facil_api') then return new;end if;
 if row(new.id,new.tenant_id,new.created_by,new.created_at,new.operation_id,new.request_hash)
 is distinct from row(old.id,old.tenant_id,old.created_by,old.created_at,old.operation_id,old.request_hash) then
  raise exception 'DRAFT_IDENTITY_IMMUTABLE' using errcode='42501';
 end if;
 if new.archived_at is distinct from old.archived_at then
  if not coalesce(private.has_access(old.tenant_id,'invoices.delete',old.department_id),false)
   or (to_jsonb(new)-array['archived_at','version','updated_by','updated_at']) is distinct from (to_jsonb(old)-array['archived_at','version','updated_by','updated_at']) then
   raise exception 'FORBIDDEN_ARCHIVE_UPDATE' using errcode='42501';
  end if;
 elsif not coalesce(private.has_access(old.tenant_id,'invoices.edit',old.department_id) and private.has_access(new.tenant_id,'invoices.edit',new.department_id),false) then
  raise exception 'FORBIDDEN_DRAFT_EDIT' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_invoice_draft_actions() from public,anon,authenticated;
create trigger guard_invoice_draft_actions before update on public.invoice_drafts for each row execute function private.guard_invoice_draft_actions();

-- A creator may insert initial lines only in the transaction that inserted the
-- parent draft (xmin), then requires edit for every later line mutation.
alter policy insert_scope on public.invoice_draft_lines with check(exists(
 select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null
 and (private.has_access(d.tenant_id,'invoices.edit',d.department_id) or
 (private.has_access(d.tenant_id,'invoices.create',d.department_id) and d.xmin=pg_catalog.pg_current_xact_id()::xid
 and d.created_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid))));
alter policy update_scope on public.invoice_draft_lines
 using(exists(select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null and private.has_access(d.tenant_id,'invoices.edit',d.department_id)))
 with check(exists(select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null and private.has_access(d.tenant_id,'invoices.edit',d.department_id)));
alter policy delete_scope on public.invoice_draft_lines using(exists(select 1 from public.invoice_drafts d where d.tenant_id=invoice_draft_lines.tenant_id and d.id=draft_id and d.archived_at is null and private.has_access(d.tenant_id,'invoices.edit',d.department_id)));

alter policy invoice_prepare on public.electronic_invoices with check(
 private.has_access(tenant_id,'invoices.create',department_id)
 and created_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
 and document_status='prepared' and signature_status='pending' and transmission_status='not_sent'
 and hacienda_status='pending' and email_status='not_queued');
alter policy invoice_refresh on public.electronic_invoices
 using(document_status='prepared' and transmission_status='not_sent' and private.has_access(tenant_id,'invoices.edit',department_id))
 with check(document_status='prepared' and transmission_status='not_sent' and private.has_access(tenant_id,'invoices.edit',department_id));

-- UPDATE policies are permissive: emit must never authorize snapshot editing,
-- and edit must never authorize numbering/signing/transmission state changes.
create function private.guard_invoice_preparation_actions() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user<>'conta_facil_api' or old.document_status<>'prepared' then return new;end if;
 if row(new.snapshot,new.options,new.draft_version,new.document_type,new.draft_id,new.environment,new.department_id,new.tenant_id)
 is distinct from row(old.snapshot,old.options,old.draft_version,old.document_type,old.draft_id,old.environment,old.department_id,old.tenant_id)
 and not coalesce(private.has_access(old.tenant_id,'invoices.edit',old.department_id) and private.has_access(new.tenant_id,'invoices.edit',new.department_id),false) then
  raise exception 'FORBIDDEN_PREPARATION_EDIT' using errcode='42501';
 end if;
 if row(new.document_status,new.signature_status,new.transmission_status,new.hacienda_status,new.email_status,new.clave,new.consecutivo,new.issued_at,new.credential_version,new.certificate_fingerprint,new.issue_operation_id,new.issued_by,new.response_trust_policy)
 is distinct from row(old.document_status,old.signature_status,old.transmission_status,old.hacienda_status,old.email_status,old.clave,old.consecutivo,old.issued_at,old.credential_version,old.certificate_fingerprint,old.issue_operation_id,old.issued_by,old.response_trust_policy)
 and not coalesce(private.has_access(old.tenant_id,'invoices.emit',old.department_id) and nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2',false) then
  raise exception 'FORBIDDEN_PREPARATION_ISSUE' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_invoice_preparation_actions() from public,anon,authenticated;
create trigger guard_invoice_preparation_actions before update on public.electronic_invoices for each row execute function private.guard_invoice_preparation_actions();

-- Only invoice readers of an assigned department may see active issuer choices.
create policy invoice_activity_read on public.economic_activities for select to authenticated using(active and exists(select 1 from public.departments d where d.tenant_id=economic_activities.tenant_id and private.has_access(d.tenant_id,'invoices.read',d.id)));
create policy invoice_branch_read on public.branches for select to authenticated using(active and exists(select 1 from public.departments d where d.tenant_id=branches.tenant_id and private.has_access(d.tenant_id,'invoices.read',d.id)));
create policy invoice_terminal_read on public.terminals for select to authenticated using(active and exists(select 1 from public.departments d where d.tenant_id=terminals.tenant_id and private.has_access(d.tenant_id,'invoices.read',d.id)));

-- Existing FE counters retain every stored value; TE has its own counter.
alter table private.emission_sequences
 add column document_type text not null default 'FE' check(document_type in('FE','TE')),
 drop constraint emission_sequences_pkey,
 add primary key(tenant_id,environment,branch_code,terminal_code,document_type);
drop function private.confirm_emission_numbering(uuid,text,text,numeric,text);
create function private.confirm_emission_numbering(t uuid,b text,tr text,starting_value numeric,e text default 'test',requested_document_type text default 'FE')
returns void language plpgsql security definer set search_path='' as $$
declare floor_value numeric; selected_branch uuid; selected_terminal uuid;
begin
 if not private.is_system_administrator() or not private.has_access(t,'tax.manage',null) then raise exception 'FORBIDDEN';end if;
 if e is null or e not in('test','production') then raise exception 'INVALID_ENVIRONMENT';end if;
 if requested_document_type is null or requested_document_type not in('FE','TE') then raise exception 'INVALID_DOCUMENT_TYPE';end if;
 if starting_value is null or starting_value<>trunc(starting_value) or starting_value<0 or starting_value>9999999999 then raise exception 'INVALID_SEQUENCE';end if;
 select br.id,te.id into selected_branch,selected_terminal from public.branches br join public.terminals te on te.tenant_id=br.tenant_id and te.branch_id=br.id
 where br.tenant_id=t and br.code=b and te.code=tr and br.active and te.active for update of br,te;
 if not found then raise exception 'INVALID_BRANCH_TERMINAL';end if;
 perform 1 from public.document_sequences s where s.tenant_id=t and s.branch_id=selected_branch and s.terminal_id=selected_terminal and s.document_type=requested_document_type for update;
 select coalesce(max(s.last_value),0) into floor_value from public.document_sequences s
 where s.tenant_id=t and s.branch_id=selected_branch and s.terminal_id=selected_terminal and s.document_type=requested_document_type;
 if starting_value<floor_value then raise exception 'LEGACY_SEQUENCE_FLOOR';end if;
 insert into private.emission_sequences(tenant_id,environment,branch_code,terminal_code,last_value,confirmed_by,confirmed_at,legacy_floor,document_type)
 values(t,e,b,tr,starting_value,(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid,now(),floor_value,requested_document_type)
 on conflict(tenant_id,environment,branch_code,terminal_code,document_type) do update set
 last_value=excluded.last_value,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,legacy_floor=excluded.legacy_floor
 where private.emission_sequences.last_value<=excluded.last_value;
 if not found then raise exception 'SEQUENCE_CANNOT_DECREASE';end if;
 insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details)
 values(t,(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid,'CONFIRM_EMISSION_NUMBERING','emission_sequences',b||tr,
 jsonb_build_object('environment',e,'document_type',requested_document_type,'starting_value',starting_value,'legacy_floor',floor_value));
end $$;
revoke all on function private.confirm_emission_numbering(uuid,text,text,numeric,text,text) from public,anon,authenticated;
grant execute on function private.confirm_emission_numbering(uuid,text,text,numeric,text,text) to conta_facil_api;

-- Automatic reconciliation may collect evidence of an already sent operation
-- after an operator loses emission authority. A manually requested query is
-- explicitly classified and must retain its own actor's read/query authority.
alter table private.emission_jobs
 add column request_origin text not null default 'automatic' check(request_origin in('automatic','manual')),
 add column requested_by uuid references public.profiles,
 add constraint emission_job_request_actor_check check(
  (request_origin='automatic' and requested_by is null) or
  (request_origin='manual' and kind='query' and requested_by is not null));
create function private.guard_emission_job_request_origin() returns trigger language plpgsql set search_path='' as $$
begin
 if old.request_origin='manual' and new.request_origin<>'manual' then
  raise exception 'MANUAL_QUERY_ORIGIN_IMMUTABLE' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.guard_emission_job_request_origin() from public,anon,authenticated;
create trigger guard_emission_job_request_origin before update on private.emission_jobs for each row execute function private.guard_emission_job_request_origin();

create or replace function private.emission_job_document(job uuid,token uuid)
returns setof public.electronic_invoices language sql stable security definer set search_path='' as $$
 select i.* from private.emission_jobs j
 join public.electronic_invoices i on i.tenant_id=j.tenant_id and i.id=j.invoice_id and i.environment=j.environment
 where j.id=job and j.lease_token=token and j.status='leased' and j.lease_until>pg_catalog.now()
 and (
  (j.kind='query' and j.request_origin='automatic' and i.transmission_status in('sent','uncertain','processing'))
  or exists(
   select 1 from public.memberships m join public.profiles p on p.id=m.user_id join public.tenants t on t.id=m.tenant_id
   where m.tenant_id=i.tenant_id and m.user_id=case when j.kind='query' and j.request_origin='manual' then j.requested_by else coalesce(i.issued_by,i.created_by) end
   and m.active and p.active and t.active
   and exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission=case when j.kind='query' then 'invoices.query' else 'invoices.emit' end)
   and (j.kind<>'query' or exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission='invoices.read'))
   and (m.scope='company' or exists(select 1 from public.membership_departments md where md.tenant_id=m.tenant_id and md.user_id=m.user_id and md.department_id=i.department_id))
   and (j.kind<>'query' or i.transmission_status in('sent','uncertain','processing'))
  )
 );
$$;
revoke all on function private.emission_job_document(uuid,uuid) from public,anon,authenticated;
grant execute on function private.emission_job_document(uuid,uuid) to conta_facil_api;

create or replace function private.invoice_emission_metadata(t uuid,i uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'company',(select jsonb_build_object('identification',tnt.identification,'identification_type',tnt.identification_type,
  'configuration_version',tnt.configuration_version,'send_email',tnt.configuration->'billing'->'send_email')
  from public.tenants tnt where tnt.id=d.tenant_id and tnt.active),
 'activity',exists(select 1 from public.economic_activities a where a.tenant_id=d.tenant_id and a.code=d.options->>'issuer_activity' and a.active),
 'terminal',exists(select 1 from public.branches b join public.terminals tr on tr.tenant_id=b.tenant_id and tr.branch_id=b.id
  where b.tenant_id=d.tenant_id and b.code=d.options->>'branch_code' and tr.code=d.options->>'terminal_code' and b.active and tr.active),
 'credential_version',v.version,'certificate_metadata',c.certificate_metadata,'api_status',c.api_status,
 -- Invoice readers need readiness metadata even when they cannot open Hacienda
 -- settings. The outer invoice authorization gates this narrowly scoped read.
 'enrollment',(select jsonb_build_object('environment',e.environment,'version',e.version,'status',e.status,
  'issuer_identification',e.issuer_identification,'issuer_identification_type',e.issuer_identification_type,
  'certificate_fingerprint',e.certificate_fingerprint,'confirmed_by',e.confirmed_by,
  'confirmed_at',e.confirmed_at,'evidence_reference',e.evidence_reference)
  from private.hacienda_credential_enrollments e join public.tenants tnt on tnt.id=e.tenant_id
  where e.tenant_id=d.tenant_id and e.environment=d.environment and e.version=v.version and e.status='operator_verified'
   and e.certificate_fingerprint=pg_catalog.lower(pg_catalog.replace(c.certificate_metadata->>'fingerprint',':',''))
   and e.issuer_identification=tnt.identification and e.issuer_identification_type=tnt.identification_type and tnt.active),
 'numbering',(select jsonb_build_object('last_value',s.last_value,'confirmed_at',s.confirmed_at,'legacy_floor',s.legacy_floor)
  from private.emission_sequences s where s.tenant_id=d.tenant_id and s.environment=d.environment and s.document_type=d.document_type
   and s.branch_code=d.options->>'branch_code' and s.terminal_code=d.options->>'terminal_code'))
 from public.electronic_invoices d
 left join public.hacienda_configuration c on c.tenant_id=d.tenant_id and c.environment=d.environment
 left join private.hacienda_credential_versions v on v.tenant_id=c.tenant_id and v.environment=c.environment and v.version=c.active_version and v.active
 where d.tenant_id=t and d.id=i and private.has_access(t,'invoices.read',d.department_id);
$$;
revoke all on function private.invoice_emission_metadata(uuid,uuid) from public,anon;
grant execute on function private.invoice_emission_metadata(uuid,uuid) to authenticated,conta_facil_api;
