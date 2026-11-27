-- Separate fiscal preparation, manual delivery, reports and numbering without
-- changing memberships, departments, fiscal data, stored counters or MFA gates.
insert into public.permission_catalog(code,module,action) values
 ('invoices.prepare','invoices','prepare'),('invoices.email','invoices','email'),
 ('invoices.numbering','invoices','numbering'),('reports.read','reports','read')
on conflict do nothing;
insert into public.role_permissions(tenant_id,role_id,permission)
 select tenant_id,role_id,'invoices.prepare' from public.role_permissions where permission='invoices.manage' on conflict do nothing;
insert into public.role_permissions(tenant_id,role_id,permission)
 select tenant_id,role_id,'invoices.email' from public.role_permissions where permission='invoices.emit' on conflict do nothing;
insert into public.role_permissions(tenant_id,role_id,permission)
 select tenant_id,role_id,'invoices.numbering' from public.role_permissions where permission='tax.manage' on conflict do nothing;
insert into public.role_permissions(tenant_id,role_id,permission)
 select r.tenant_id,r.id,p.code from public.roles r cross join public.permission_catalog p
 where (r.code='admin' and p.code in('invoices.prepare','invoices.email','invoices.numbering','reports.read'))
 or (r.code in('accountant','auditor') and p.code='reports.read') on conflict do nothing;


create or replace function private.has_access(t uuid,p text,d uuid default null) returns boolean language sql stable security definer set search_path='' as $$
select private.valid_session() and exists(select 1 from public.memberships m join public.tenants tnt on tnt.id=m.tenant_id
where m.tenant_id=t and m.user_id=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and m.active and tnt.active
and exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=t and mr.user_id=m.user_id and rp.permission=p)
and (m.scope='company' or (d is not null and exists(select 1 from public.membership_departments md where md.tenant_id=t and md.user_id=m.user_id and md.department_id=d)))
and (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2' or not exists(select 1 from public.membership_roles mr join public.roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id where mr.tenant_id=t and mr.user_id=m.user_id and r.code='admin'))
and ((p not like '%.manage' and p not in('invoices.create','invoices.edit','invoices.delete','invoices.credit_note','invoices.debit_note','invoices.prepare','invoices.email','invoices.numbering')) or nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2')
and (p not in('company.manage','users.manage','organization.manage','tax.manage','invoices.numbering','hacienda.credentials.manage','hacienda.connection.test') or private.is_system_administrator()));
$$;

create or replace function private.seed_roles()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.roles(tenant_id,code,name) values
 (new.id,'admin','Administrador de empresa'),(new.id,'accountant','Contador'),
 (new.id,'billing','Encargado de facturación'),(new.id,'reception','Encargado de recepción'),
 (new.id,'department','Jefe de departamento'),(new.id,'operative','Usuario operativo'),
 (new.id,'auditor','Auditor de solo lectura');
 insert into public.role_permissions
 select new.id,r.id,p.code from public.roles r cross join public.permission_catalog p
 where r.tenant_id=new.id and (
 r.code='admin'
 or (r.code in('accountant','auditor') and p.action='read'
     and p.module not in('hacienda','collections','payables','document_workflow'))
 or (r.code in('billing','reception','department','operative')
     and p.code in('company.read','organization.read'))
 or (r.code='billing' and p.code in('customers.read','catalog.read','invoices.read',
     'invoices.manage','invoices.create','invoices.edit','invoices.delete','invoices.prepare')));
 return new;
end $$;


alter policy invoice_prepare on public.electronic_invoices with check(
 private.has_access(tenant_id,'invoices.prepare',department_id)
 and created_by=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
 and document_status='prepared' and signature_status='pending' and transmission_status='not_sent'
 and hacienda_status='pending' and email_status='not_queued');
alter policy invoice_refresh on public.electronic_invoices
 using(document_status='prepared' and transmission_status='not_sent' and private.has_access(tenant_id,'invoices.prepare',department_id))
 with check(document_status='prepared' and transmission_status='not_sent' and private.has_access(tenant_id,'invoices.prepare',department_id));
create policy invoice_email_update on public.electronic_invoices for update to conta_facil_api
 using(document_status='issued' and hacienda_status='accepted' and private.has_access(tenant_id,'invoices.email',department_id))
 with check(document_status='issued' and hacienda_status='accepted' and private.has_access(tenant_id,'invoices.email',department_id));
-- A permissive UPDATE policy must not allow email authority to change fiscal or
-- transmission data. Existing invoice immutability and preparation guards stay.
create function private.guard_invoice_email_action() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user='conta_facil_api' and old.document_status='issued'
 and not coalesce(private.has_access(old.tenant_id,'invoices.emit',old.department_id),false) then
  if not coalesce(private.has_access(old.tenant_id,'invoices.email',old.department_id),false)
  or old.hacienda_status<>'accepted' or new.email_status<>'queued'
  or (to_jsonb(new)-array['version','updated_at','email_status','email_dispatch_id'])
   is distinct from (to_jsonb(old)-array['version','updated_at','email_status','email_dispatch_id']) then
   raise exception 'FORBIDDEN_EMAIL_INVOICE_PATCH' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_invoice_email_action() from public,anon,authenticated;
create trigger guard_invoice_email_action before update on public.electronic_invoices for each row execute function private.guard_invoice_email_action();
alter table private.emission_jobs drop constraint emission_job_request_actor_check,
 add constraint emission_job_request_actor_check check(
  (request_origin='automatic' and requested_by is null) or
  (request_origin='manual' and kind in('query','email') and requested_by is not null));
-- Previously recorded manual resends retain their actual actor and authority.
update private.emission_jobs j set request_origin='manual',requested_by=(
 select a.actor_id from private.emission_actions a where a.tenant_id=j.tenant_id and a.invoice_id=j.invoice_id and a.action='resend_email' order by a.created_at desc,a.operation_id desc limit 1)
 where j.kind='email' and j.request_origin='automatic' and exists(
 select 1 from private.emission_actions a where a.tenant_id=j.tenant_id and a.invoice_id=j.invoice_id and a.action='resend_email');


create or replace function private.guard_invoice_preparation_actions() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user<>'conta_facil_api' or old.document_status<>'prepared' then return new;end if;
 if row(new.snapshot,new.options,new.draft_version,new.document_type,new.draft_id,new.environment,new.department_id,new.tenant_id)
 is distinct from row(old.snapshot,old.options,old.draft_version,old.document_type,old.draft_id,old.environment,old.department_id,old.tenant_id)
 and not coalesce(private.has_access(old.tenant_id,'invoices.prepare',old.department_id) and private.has_access(new.tenant_id,'invoices.prepare',new.department_id),false) then
  raise exception 'FORBIDDEN_PREPARATION_EDIT' using errcode='42501';
 end if;
 if row(new.document_status,new.signature_status,new.transmission_status,new.hacienda_status,new.email_status,new.clave,new.consecutivo,new.issued_at,new.credential_version,new.certificate_fingerprint,new.issue_operation_id,new.issued_by,new.response_trust_policy)
 is distinct from row(old.document_status,old.signature_status,old.transmission_status,old.hacienda_status,old.email_status,old.clave,old.consecutivo,old.issued_at,old.credential_version,old.certificate_fingerprint,old.issue_operation_id,old.issued_by,old.response_trust_policy)
 and not coalesce(private.has_access(old.tenant_id,'invoices.emit',old.department_id) and nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2',false) then
  raise exception 'FORBIDDEN_PREPARATION_ISSUE' using errcode='42501';
 end if;
 return new;
end $$;

create or replace function private.confirm_emission_numbering(t uuid,b text,tr text,starting_value numeric,e text default 'test',requested_document_type text default 'FE')
returns void language plpgsql security definer set search_path='' as $$
declare floor_value numeric; selected_branch uuid; selected_terminal uuid;
begin
 if not private.is_system_administrator() or not private.has_access(t,'tax.manage',null) or not private.has_access(t,'invoices.numbering',null) then raise exception 'FORBIDDEN';end if;
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

create or replace function private.emission_job_document(job uuid,token uuid)
returns setof public.electronic_invoices language sql stable security definer set search_path='' as $$
 select i.* from private.emission_jobs j
 join public.electronic_invoices i on i.tenant_id=j.tenant_id and i.id=j.invoice_id and i.environment=j.environment
 where j.id=job and j.lease_token=token and j.status='leased' and j.lease_until>pg_catalog.now()
 and (
  (j.kind='query' and j.request_origin='automatic' and i.transmission_status in('sent','uncertain','processing'))
  or exists(
   select 1 from public.memberships m join public.profiles p on p.id=m.user_id join public.tenants t on t.id=m.tenant_id
   where m.tenant_id=i.tenant_id and m.user_id=case when j.request_origin='manual' then j.requested_by else coalesce(i.issued_by,i.created_by) end
   and m.active and p.active and t.active
   and exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission=case when j.kind='query' then 'invoices.query' when j.kind='email' and j.request_origin='manual' then 'invoices.email' else 'invoices.emit' end)
   and ((j.kind<>'query' and not(j.kind='email' and j.request_origin='manual')) or exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission='invoices.read'))
   and (m.scope='company' or exists(select 1 from public.membership_departments md where md.tenant_id=m.tenant_id and md.user_id=m.user_id and md.department_id=i.department_id))
   and (j.kind<>'query' or i.transmission_status in('sent','uncertain','processing'))
  )
 );
$$;
