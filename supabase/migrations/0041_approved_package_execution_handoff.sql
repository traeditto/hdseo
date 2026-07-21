-- Make a client approval a complete, attributable ledger event. Application
-- workers use the package id as the durable continuation key; this migration
-- repairs legacy approvals that carried a digest but no approver/timestamp.

create index if not exists implementation_packages_approved_queue_idx
  on public.implementation_packages(agency_id,client_organization_id,project_id,approved_at,updated_at)
  where status='client_approved';

with latest_approval as (
  select distinct on (package_id)
    package_id,actor_user_id,occurred_at
  from public.proof_of_work_events
  where event_type='client_approved' and package_id is not null
  order by package_id,occurred_at desc
)
update public.implementation_packages p set
  approved_by=coalesce(p.approved_by,a.actor_user_id),
  approved_at=coalesce(p.approved_at,a.occurred_at,p.updated_at),
  updated_at=greatest(p.updated_at,coalesce(a.occurred_at,p.updated_at))
from latest_approval a
where p.id=a.package_id and p.status='client_approved'
  and (p.approved_by is null or p.approved_at is null);

update public.implementation_packages set
  approved_at=coalesce(approved_at,updated_at)
where status='client_approved' and approved_at is null and approval_digest is not null;

create or replace function public.decide_implementation_package(
  p_agency_id uuid,p_client_organization_id uuid,p_project_id uuid,p_package_id uuid,
  p_user_id uuid,p_decision text,p_note text default null,p_approval_digest text default null,
  p_approved_snapshot jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_package public.implementation_packages;
  v_publication_id uuid;
  v_task_id uuid;
  v_task_status text;
  v_decided_at timestamptz := now();
begin
  if p_decision not in ('client_approved','revision_requested','rejected') then raise exception 'INVALID_DECISION'; end if;
  if not exists(
    select 1 from public.client_members m where m.agency_id=p_agency_id
      and m.client_organization_id=p_client_organization_id and m.user_id=p_user_id
      and m.status='active' and m.role in ('client_admin','client_approver')
  ) then raise exception 'CLIENT_APPROVER_REQUIRED'; end if;
  select * into v_package from public.implementation_packages
    where id=p_package_id and agency_id=p_agency_id
      and client_organization_id=p_client_organization_id and project_id=p_project_id
    for update;
  if v_package.id is null then raise exception 'PACKAGE_NOT_FOUND'; end if;
  if v_package.status not in ('client_review','awaiting_client') then raise exception 'PACKAGE_ALREADY_DECIDED'; end if;
  select id into v_publication_id from public.client_portal_publications
    where agency_id=p_agency_id and client_organization_id=p_client_organization_id
      and project_id=p_project_id and record_type='implementation_package'
      and source_id=p_package_id and revoked_at is null and status='awaiting_client'
    for update;
  if v_publication_id is null then raise exception 'PUBLICATION_ALREADY_DECIDED'; end if;
  if p_decision='client_approved' and (p_approval_digest is null or length(p_approval_digest)<>64)
    then raise exception 'APPROVAL_DIGEST_REQUIRED'; end if;
  update public.implementation_packages set
    status=p_decision,
    approval_digest=case when p_decision='client_approved' then p_approval_digest else null end,
    approved_snapshot=case when p_decision='client_approved' then p_approved_snapshot else '{}'::jsonb end,
    approved_by=case when p_decision='client_approved' then p_user_id else null end,
    approved_at=case when p_decision='client_approved' then v_decided_at else null end,
    updated_at=v_decided_at
    where id=p_package_id;
  update public.client_portal_publications set status=p_decision where id=v_publication_id;
  select task_id into v_task_id from public.proof_of_work_events
    where package_id=p_package_id and task_id is not null order by occurred_at desc limit 1;
  v_task_status:=case when p_decision='client_approved' then 'approved' else p_decision end;
  if v_task_id is not null then
    update public.seo_task_approvals set status=v_task_status,decided_by=p_user_id,
      decision_note=p_note,decided_at=v_decided_at
      where task_id=v_task_id and approval_type='client';
  end if;
  if p_decision='client_approved' then
    update public.seo_opportunities set status='in_progress',updated_at=v_decided_at
      where id=v_package.opportunity_id and agency_id=p_agency_id
        and client_organization_id=p_client_organization_id and project_id=p_project_id
        and status in ('open','selected','approved');
  end if;
  insert into public.proof_of_work_events(
    agency_id,client_organization_id,project_id,opportunity_id,package_id,task_id,
    event_type,title,description,client_visible,actor_user_id,metadata,occurred_at
  ) values(
    p_agency_id,p_client_organization_id,p_project_id,v_package.opportunity_id,p_package_id,v_task_id,
    p_decision,'Client '||replace(p_decision,'_',' '),coalesce(p_note,'Client decision recorded.'),
    true,p_user_id,jsonb_build_object('approvalDigest',p_approval_digest),v_decided_at
  );
  return jsonb_build_object('packageId',p_package_id,'decision',p_decision,
    'approvalDigest',p_approval_digest,'approvedAt',case when p_decision='client_approved' then v_decided_at else null end);
end $$;

revoke all on function public.decide_implementation_package(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.decide_implementation_package(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) to service_role;

-- Wake approvals that were already stranded before the event-driven handoff was
-- deployed. This is tenant-scoped, idempotent, and does not reserve capacity.
update public.agent_service_enrollments e set
  next_cycle_at=least(e.next_cycle_at,now()),
  updated_at=now()
where e.service_mode='managed_agent' and e.status in ('trialing','active')
  and exists(
    select 1 from public.implementation_packages p
    where p.agency_id=e.agency_id
      and p.client_organization_id=e.client_organization_id
      and p.project_id=e.project_id
      and p.status='client_approved'
      and not exists(
        select 1 from public.agent_service_cycles c
        where c.implementation_package_id=p.id
      )
  );
