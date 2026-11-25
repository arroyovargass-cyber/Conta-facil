-- Reviewed STAG numbering is separate from historical, environmentless sequences.
create table private.emission_sequences(
 tenant_id uuid not null references public.tenants, environment text not null check(environment='test'),
 branch_code text not null check(branch_code ~ '^[0-9]{3}$' and branch_code<>'000'),
 terminal_code text not null check(terminal_code ~ '^[0-9]{5}$' and terminal_code<>'00000'),
 last_value numeric(10,0) not null check(last_value between 0 and 9999999999),
 confirmed_by uuid not null references public.profiles, confirmed_at timestamptz not null,
 legacy_floor numeric(10,0) not null check(legacy_floor>=0),
 primary key(tenant_id,environment,branch_code,terminal_code)
);
alter table private.emission_sequences enable row level security;
revoke all on private.emission_sequences from public,anon,authenticated;
grant select,update on private.emission_sequences to conta_facil_api;
create policy server_internal_access on private.emission_sequences for all to conta_facil_api using(true) with check(true);
create function private.confirm_emission_numbering(t uuid,b text,tr text,starting_value numeric)
returns void language plpgsql security definer set search_path='' as $$
declare floor_value numeric; selected_branch uuid; selected_terminal uuid;
begin
 if not private.is_system_administrator() or not private.has_access(t,'tax.manage',null) then raise exception 'FORBIDDEN';end if;
 if starting_value is null or starting_value<>trunc(starting_value) or starting_value<0 or starting_value>9999999999 then raise exception 'INVALID_SEQUENCE';end if;
 select br.id,te.id into selected_branch,selected_terminal from public.branches br join public.terminals te on te.tenant_id=br.tenant_id and te.branch_id=br.id where br.tenant_id=t and br.code=b and te.code=tr and br.active and te.active for update of br,te;
 if not found then raise exception 'INVALID_BRANCH_TERMINAL';end if;
 perform 1 from public.document_sequences s where s.tenant_id=t and s.branch_id=selected_branch and s.terminal_id=selected_terminal for update;
 select coalesce(max(s.last_value),0) into floor_value from public.document_sequences s where s.tenant_id=t and s.branch_id=selected_branch and s.terminal_id=selected_terminal and s.document_type='FE';
 if starting_value<floor_value then raise exception 'LEGACY_SEQUENCE_FLOOR';end if;
 insert into private.emission_sequences values(t,'test',b,tr,starting_value,auth.uid(),now(),floor_value)
 on conflict(tenant_id,environment,branch_code,terminal_code) do update set last_value=excluded.last_value,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,legacy_floor=excluded.legacy_floor where private.emission_sequences.last_value<=excluded.last_value;
 if not found then raise exception 'SEQUENCE_CANNOT_DECREASE';end if;
 insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details) values(t,auth.uid(),'CONFIRM_EMISSION_NUMBERING','emission_sequences',b||tr,jsonb_build_object('environment','test','starting_value',starting_value,'legacy_floor',floor_value));
end $$;
revoke all on function private.confirm_emission_numbering(uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function private.confirm_emission_numbering(uuid,text,text,numeric) to conta_facil_api;

create function private.invoice_emission_metadata(t uuid,i uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('company',(select jsonb_build_object('identification',tnt.identification,'configuration_version',tnt.configuration_version,'send_email',tnt.configuration->'billing'->'send_email') from public.tenants tnt where tnt.id=d.tenant_id and tnt.active),
 'activity',exists(select 1 from public.economic_activities a where a.tenant_id=d.tenant_id and a.code=d.options->>'issuer_activity' and a.active),
 'terminal',exists(select 1 from public.branches b join public.terminals tr on tr.tenant_id=b.tenant_id and tr.branch_id=b.id where b.tenant_id=d.tenant_id and b.code=d.options->>'branch_code' and tr.code=d.options->>'terminal_code' and b.active and tr.active),
 'credential_version',v.version,'certificate_metadata',c.certificate_metadata,'api_status',c.api_status,
 'numbering',(select jsonb_build_object('last_value',s.last_value,'confirmed_at',s.confirmed_at,'legacy_floor',s.legacy_floor) from private.emission_sequences s where s.tenant_id=d.tenant_id and s.environment=d.environment and s.branch_code=d.options->>'branch_code' and s.terminal_code=d.options->>'terminal_code'))
 from public.electronic_invoices d left join public.hacienda_configuration c on c.tenant_id=d.tenant_id and c.environment=d.environment
 left join private.hacienda_credential_versions v on v.tenant_id=c.tenant_id and v.environment=c.environment and v.version=c.active_version and v.active
 where d.tenant_id=t and d.id=i and private.has_access(t,'invoices.read',d.department_id);
$$;
revoke all on function private.invoice_emission_metadata(uuid,uuid) from public,anon;
grant execute on function private.invoice_emission_metadata(uuid,uuid) to authenticated,conta_facil_api;
alter table public.electronic_invoices add column certificate_fingerprint text check(certificate_fingerprint ~ '^[a-f0-9]{64}$'),add column issue_operation_id uuid,add column issued_by uuid references public.profiles;
create unique index electronic_invoice_clave_unique on public.electronic_invoices(tenant_id,environment,clave) where clave is not null;
grant update(document_status,signature_status,transmission_status,clave,consecutivo,issued_at,credential_version,certificate_fingerprint,issue_operation_id,issued_by) on public.electronic_invoices to conta_facil_api;
create policy invoice_issue on public.electronic_invoices for update to conta_facil_api using(private.has_access(tenant_id,'invoices.emit',department_id) and auth.jwt()->>'aal'='aal2') with check(private.has_access(tenant_id,'invoices.emit',department_id) and auth.jwt()->>'aal'='aal2');
create function private.guard_issued_invoice() returns trigger language plpgsql set search_path='' as $$
begin
 if old.document_status='issued' and (new.snapshot is distinct from old.snapshot or new.options is distinct from old.options or new.tenant_id<>old.tenant_id or new.department_id<>old.department_id or new.document_status<>old.document_status or new.clave is distinct from old.clave or new.consecutivo is distinct from old.consecutivo or new.issued_at is distinct from old.issued_at or new.credential_version is distinct from old.credential_version or new.certificate_fingerprint is distinct from old.certificate_fingerprint or new.issue_operation_id is distinct from old.issue_operation_id or new.issued_by is distinct from old.issued_by) then raise exception 'ISSUED_INVOICE_IMMUTABLE';end if;
 return new;
end $$;
revoke all on function private.guard_issued_invoice() from public;
create trigger issued_invoice_immutable before update on public.electronic_invoices for each row execute function private.guard_issued_invoice();

create or replace function private.emission_job_document(job uuid,token uuid)
returns setof public.electronic_invoices language sql stable security definer set search_path='' as $$
 select i.* from private.emission_jobs j
 join public.electronic_invoices i on i.tenant_id=j.tenant_id and i.id=j.invoice_id
 where j.id=job and j.lease_token=token and j.status='leased' and j.lease_until>pg_catalog.now()
 and (
   (j.kind='query' and i.transmission_status in('sent','uncertain','processing'))
   or exists(
    select 1 from public.memberships m
    join public.profiles p on p.id=m.user_id
    join public.tenants t on t.id=m.tenant_id
    where m.tenant_id=i.tenant_id and m.user_id=coalesce(i.issued_by,i.created_by) and m.active and p.active and t.active
    and exists(select 1 from public.membership_roles mr join public.role_permissions rp
      on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
      where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission='invoices.emit')
    and (m.scope='company' or exists(select 1 from public.membership_departments md
      where md.tenant_id=m.tenant_id and md.user_id=m.user_id and md.department_id=i.department_id))
   )
 );
$$;
revoke all on function private.emission_job_document(uuid,uuid) from public,anon,authenticated;
grant execute on function private.emission_job_document(uuid,uuid) to conta_facil_api;


notify pgrst,'reload schema';
