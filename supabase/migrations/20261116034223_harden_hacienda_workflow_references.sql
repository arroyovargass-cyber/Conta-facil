-- Validate real source/destination relationships, not caller-provided aliases.
create function private.workflow_assignee_eligible(t uuid,u uuid,d uuid,f text) returns boolean language sql stable security definer set search_path='' as $$
select u is null or exists(
 select 1 from public.memberships m join public.profiles p on p.id=m.user_id
 join public.tenants tt on tt.id=m.tenant_id
 join public.departments dd on dd.tenant_id=m.tenant_id and dd.id=d
 where m.tenant_id=t and m.user_id=u and m.active and p.active and tt.active and dd.active
 and (m.scope='company' or exists(select 1 from public.membership_departments md where md.tenant_id=t and md.user_id=u and md.department_id=d))
 and exists(select 1 from public.membership_roles mr join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
 where mr.tenant_id=t and mr.user_id=u and rp.permission=f||'.read')
);
$$;
revoke all on function private.workflow_assignee_eligible(uuid,uuid,uuid,text) from public;
grant execute on function private.workflow_assignee_eligible(uuid,uuid,uuid,text) to conta_facil_api;
create function private.validate_document_route() returns trigger language plpgsql security definer set search_path='' as $$
begin
if new.enabled then
 perform 1 from public.departments where tenant_id=new.tenant_id and id=new.target_department_id and active for share;
 if not found or not private.workflow_assignee_eligible(new.tenant_id,new.assignee_id,new.target_department_id,new.flow) then raise exception using errcode='23514',message='Invalid route destination or assignee';end if;
end if;return new;
end $$;
revoke all on function private.validate_document_route() from public;
create trigger validate_route before insert or update on public.document_routes for each row execute function private.validate_document_route();
create function private.validate_document_work() returns trigger language plpgsql security definer set search_path='' as $$
declare source public.invoice_drafts; route public.document_routes;
begin
if tg_op='INSERT' then
 select * into source from public.invoice_drafts where tenant_id=new.tenant_id and id=new.source_id for share;
 if not found or source.archived_at is not null or source.department_id<>new.source_department_id or source.version<>new.source_version or source.version<>new.current_version
 or new.customer_name is distinct from source.customer_snapshot->>'name' then raise exception using errcode='23514',message='Invalid workflow source';end if;
 select * into route from public.document_routes where tenant_id=new.tenant_id and flow=new.flow for share;
 if not found or not route.enabled or route.target_department_id is distinct from new.target_department_id or route.assignee_id is distinct from new.assignee_id then raise exception using errcode='23514',message='Invalid workflow route';end if;
end if;
if tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id or new.target_department_id is distinct from old.target_department_id then
 perform 1 from public.departments where tenant_id=new.tenant_id and id=new.target_department_id and active for share;
 if not found or not private.workflow_assignee_eligible(new.tenant_id,new.assignee_id,new.target_department_id,new.flow) then raise exception using errcode='23514',message='Invalid workflow assignee';end if;
end if;
return new;
end $$;
revoke all on function private.validate_document_work() from public;
create trigger validate_work before insert or update on public.document_work_items for each row execute function private.validate_document_work();
