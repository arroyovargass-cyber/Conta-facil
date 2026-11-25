alter table public.electronic_invoices add column email_dispatch_id uuid;
grant update(email_dispatch_id,email_status) on public.electronic_invoices to conta_facil_api;
create table private.emission_actions (
 tenant_id uuid not null, invoice_id uuid not null, actor_id uuid not null references public.profiles,
 operation_id uuid not null, action text not null check(action in('retry_signature','retry_transmission','query','resend_email')),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
 primary key(tenant_id,actor_id,operation_id),
 foreign key(tenant_id,invoice_id) references public.electronic_invoices(tenant_id,id)
);
create index emission_actions_limits on private.emission_actions(tenant_id,invoice_id,actor_id,created_at);
alter table private.emission_actions enable row level security;
revoke all on private.emission_actions from public,anon,authenticated;
grant select,insert on private.emission_actions to conta_facil_api;
create policy emission_actions_read on private.emission_actions for select to conta_facil_api using(true);
create policy emission_actions_insert on private.emission_actions for insert to conta_facil_api with check(true);
create function private.audit_emission_action() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details)
 values(new.tenant_id,new.actor_id,'INVOICE_MANUAL_ACTION','electronic_invoices',new.invoice_id::text,jsonb_build_object('action',new.action,'operation_id',new.operation_id));
 return new;
end $$;
revoke all on function private.audit_emission_action() from public,anon,authenticated;
create trigger emission_action_audit after insert on private.emission_actions for each row execute function private.audit_emission_action();
