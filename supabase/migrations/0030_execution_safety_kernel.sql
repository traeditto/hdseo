-- HD SEO execution safety kernel.
-- Makes external mutations exact, approval-bound, replayable, and auditable.

alter table public.deployment_checks
  drop constraint if exists deployment_checks_check_type_check;
alter table public.deployment_checks
  add constraint deployment_checks_check_type_check
  check (check_type in ('health','lighthouse','seo','links','schema','sitemap','robots','indexing_readiness','drift'));

-- Browser roles may inspect connection metadata, but encrypted credentials are
-- service-only. A column grant is used because RLS does not hide columns.
revoke select on table public.cms_connections from anon, authenticated;
grant select (
  id,agency_id,client_organization_id,project_id,website_id,cms_type,
  editor_mode,site_url,connection_mode,status,last_verified_at,created_at,updated_at
) on table public.cms_connections to authenticated;

alter table public.agent_approvals
  add column if not exists action_digest text,
  add column if not exists approved_action jsonb not null default '{}',
  add column if not exists consumed_at timestamptz;
alter table public.agent_approvals
  drop constraint if exists agent_approvals_work_item_id_approval_type_status_key;
create unique index if not exists agent_approvals_one_awaiting_per_type
  on public.agent_approvals(work_item_id,approval_type) where status='awaiting';
create index if not exists agent_approvals_item_type_time
  on public.agent_approvals(work_item_id,approval_type,requested_at desc);

alter table public.implementation_packages
  add column if not exists approval_digest text,
  add column if not exists approved_snapshot jsonb not null default '{}';

-- A legacy approval did not bind the exact payload. It must be shown to the
-- client again rather than being silently treated as authorization to write.
with reset as (
  update public.implementation_packages set status='awaiting_client',updated_at=now()
  where status='client_approved' and approval_digest is null
  returning id,agency_id,client_organization_id,project_id,opportunity_id
)
update public.client_portal_publications p set status='awaiting_client'
from reset r where p.agency_id=r.agency_id and p.client_organization_id=r.client_organization_id
  and p.project_id=r.project_id and p.record_type='implementation_package'
  and p.source_id=r.id and p.revoked_at is null;

alter table public.background_jobs
  add column if not exists fencing_token uuid;

alter table public.webhook_events
  add column if not exists processing_started_at timestamptz;
update public.webhook_events set processing_started_at=coalesce(processed_at,received_at)
  where processing_started_at is null;

alter table public.cms_publications
  drop constraint if exists cms_publications_status_check;
alter table public.cms_publications
  add constraint cms_publications_status_check
  check (status in (
    'queued','publishing','published','publish_failed','reconciliation_required',
    'rolling_back','rolled_back','rollback_failed'
  ));

insert into public.agent_tools(
  tool_key,name,description,provider,operation_type,default_risk_level,paid,destructive,secret_scope
) values
  ('cms.rollback','Rollback CMS publication','Restore the exact verified pre-publication CMS state.','cms','rollback','critical',false,true,'project'),
  ('github.merge','Merge approved pull request','Merge an exact approved repository change after required checks pass.','github','write','critical',false,true,'project')
on conflict(tool_key) do update set
  name=excluded.name,description=excluded.description,provider=excluded.provider,
  operation_type=excluded.operation_type,default_risk_level=excluded.default_risk_level,
  paid=excluded.paid,destructive=excluded.destructive,secret_scope=excluded.secret_scope,updated_at=now();

insert into public.agent_tool_grants(agent_definition_id,tool_key,permission,approval_required,constraints)
select d.id,g.tool_key,'request_only',true,'{"exactActionApproval":true}'::jsonb
from public.agent_definitions d
cross join (values ('cms.rollback'),('github.merge')) as g(tool_key)
where d.agent_key='implementation' and d.agency_id is null
on conflict(agent_definition_id,tool_key) do update set
  permission=excluded.permission,approval_required=excluded.approval_required,constraints=excluded.constraints;

create table public.mutation_intents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  work_item_id uuid references public.agent_work_items(id) on delete set null,
  tool_key text not null references public.agent_tools(tool_key),
  resource_type text not null,
  resource_id text,
  environment text,
  summary text not null,
  risk_level text not null check(risk_level in ('low','medium','high','critical')),
  approval_policy text not null check(approval_policy in ('rbac_auto','human','client_package','system_rollback')),
  action_payload jsonb not null,
  action_digest text not null check(length(action_digest)=64),
  status text not null default 'awaiting'
    check(status in ('awaiting','approved','executing','succeeded','failed','rejected','expired','cancelled')),
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  execution_ref text,
  idempotency_key text not null,
  expires_at timestamptz not null default now()+interval '30 minutes',
  approved_at timestamptz,
  execution_started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_message text,
  trace_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agency_id,idempotency_key),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create index mutation_intents_project_status_idx
  on public.mutation_intents(project_id,status,created_at desc);
create index mutation_intents_expiry_idx
  on public.mutation_intents(expires_at) where status in ('awaiting','approved');
create index if not exists webhook_events_processing_started_idx
  on public.webhook_events(processing_started_at) where status='processing';

alter table public.seo_executions
  add column if not exists repository_mutation_intent_id uuid references public.mutation_intents(id) on delete set null,
  add column if not exists repository_action_digest text;

alter table public.authority_outreach_actions
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists mutation_intent_id uuid references public.mutation_intents(id) on delete set null,
  add column if not exists action_digest text;

-- Client approval is a single transaction: the portal publication, immutable
-- package digest, linked task approval, and proof-of-work event cannot diverge.
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
    status=p_decision,approval_digest=case when p_decision='client_approved' then p_approval_digest else null end,
    approved_snapshot=case when p_decision='client_approved' then p_approved_snapshot else '{}'::jsonb end,
    updated_at=now()
    where id=p_package_id;
  update public.client_portal_publications set status=p_decision where id=v_publication_id;
  select task_id into v_task_id from public.proof_of_work_events
    where package_id=p_package_id and task_id is not null order by occurred_at desc limit 1;
  v_task_status:=case when p_decision='client_approved' then 'approved' else p_decision end;
  if v_task_id is not null then
    update public.seo_task_approvals set status=v_task_status,decided_by=p_user_id,
      decision_note=p_note,decided_at=now()
      where task_id=v_task_id and approval_type='client';
  end if;
  insert into public.proof_of_work_events(
    agency_id,client_organization_id,project_id,opportunity_id,package_id,task_id,
    event_type,title,description,client_visible,actor_user_id,metadata
  ) values(
    p_agency_id,p_client_organization_id,p_project_id,v_package.opportunity_id,p_package_id,v_task_id,
    p_decision,'Client '||replace(p_decision,'_',' '),coalesce(p_note,'Client decision recorded.'),
    true,p_user_id,jsonb_build_object('approvalDigest',p_approval_digest)
  );
  return jsonb_build_object('packageId',p_package_id,'decision',p_decision,'approvalDigest',p_approval_digest);
end $$;

alter table public.mutation_intents enable row level security;
revoke all on public.mutation_intents from anon, authenticated;

-- Revalidate the live grant and reserve spend under a row lock immediately
-- before a tool execution is recorded.
create or replace function public.authorize_agent_tool_execution(
  p_work_item_id uuid,
  p_tool_key text,
  p_cost numeric default 0
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_work public.agent_work_items;
  v_tool public.agent_tools;
  v_definition public.agent_definitions;
  v_grant public.agent_tool_grants;
  v_enrollment public.agent_service_enrollments;
  v_risk_order text[] := array['low','medium','high','critical'];
begin
  select * into v_work from public.agent_work_items where id=p_work_item_id for update;
  if v_work.id is null then raise exception 'WORK_ITEM_NOT_FOUND'; end if;
  if v_work.status not in ('planning','running','validating','waiting_for_tools') then
    raise exception 'WORK_ITEM_NOT_EXECUTABLE';
  end if;
  if not (p_tool_key=any(v_work.authorized_tools)) then raise exception 'TOOL_NOT_DECLARED'; end if;

  select * into v_tool from public.agent_tools where tool_key=p_tool_key and status='active';
  if v_tool.tool_key is null then raise exception 'TOOL_DISABLED'; end if;
  select * into v_definition from public.agent_definitions
    where agent_key=v_work.assigned_agent_key and status='active'
      and (agency_id=v_work.agency_id or agency_id is null)
    order by agency_id nulls last limit 1;
  if v_definition.id is null then raise exception 'AGENT_DISABLED'; end if;
  select * into v_grant from public.agent_tool_grants
    where agent_definition_id=v_definition.id and tool_key=p_tool_key and permission<>'denied';
  if v_grant.id is null then raise exception 'TOOL_GRANT_REVOKED'; end if;
  if array_position(v_risk_order,v_tool.default_risk_level) > array_position(v_risk_order,v_definition.default_risk_ceiling)
    then raise exception 'AGENT_RISK_CEILING_EXCEEDED'; end if;
  if array_position(v_risk_order,v_work.risk_level) > array_position(v_risk_order,v_definition.default_risk_ceiling)
    then raise exception 'WORK_RISK_CEILING_EXCEEDED'; end if;

  select * into v_enrollment from public.agent_service_enrollments
    where project_id=v_work.project_id and status in ('trialing','active') limit 1;
  if v_enrollment.id is not null then
    if cardinality(v_enrollment.allowed_tools)>0 and not (p_tool_key=any(v_enrollment.allowed_tools))
      then raise exception 'ENROLLMENT_TOOL_NOT_ALLOWED'; end if;
    if array_position(v_risk_order,v_tool.default_risk_level) > array_position(v_risk_order,v_enrollment.risk_ceiling)
      then raise exception 'ENROLLMENT_RISK_CEILING_EXCEEDED'; end if;
    if array_position(v_risk_order,v_work.risk_level) > array_position(v_risk_order,v_enrollment.risk_ceiling)
      then raise exception 'ENROLLMENT_WORK_RISK_EXCEEDED'; end if;
  end if;

  if v_grant.approval_required and not exists(
    select 1 from public.agent_approvals a where a.work_item_id=v_work.id
      and a.status='approved' and a.action_digest is not null
      and a.approved_action=a.requested_decision
      and (a.expires_at is null or a.expires_at>now())
  ) then raise exception 'TOOL_APPROVAL_REQUIRED'; end if;
  if v_enrollment.id is not null and v_enrollment.external_spend_requires_approval and p_cost>0 and not exists(
    select 1 from public.agent_approvals a where a.work_item_id=v_work.id
      and a.approval_type='spending' and a.status='approved'
      and (a.expires_at is null or a.expires_at>now())
  ) then raise exception 'EXTERNAL_SPEND_APPROVAL_REQUIRED'; end if;

  if p_cost<0 then raise exception 'INVALID_TOOL_COST'; end if;
  if v_work.spent_amount+p_cost>v_work.spending_limit then raise exception 'WORK_ITEM_SPENDING_LIMIT_EXCEEDED'; end if;
  if v_grant.spending_limit is not null and p_cost>v_grant.spending_limit then raise exception 'TOOL_GRANT_SPENDING_LIMIT_EXCEEDED'; end if;
  if p_cost>0 then
    update public.agent_work_items set spent_amount=spent_amount+p_cost,updated_at=now() where id=v_work.id;
  end if;
  return jsonb_build_object(
    'authorized',true,'riskLevel',v_tool.default_risk_level,
    'approvalRequired',v_grant.approval_required,'permission',v_grant.permission
  );
end $$;

-- A claimed worker may renew only its own lease and fencing token. Completion
-- updates use the same fence in application code, preventing a stale worker
-- from committing after another worker has reclaimed the job.
create or replace function public.extend_background_job_lease(
  p_job_id uuid,p_worker_id text,p_fencing_token uuid,p_lock_seconds int default 300
) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_updated int;
begin
  update public.background_jobs set
    lock_expires_at=now()+make_interval(secs=>greatest(30,least(p_lock_seconds,900))),updated_at=now()
  where id=p_job_id and status='running' and worker_id=p_worker_id and fencing_token=p_fencing_token;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end $$;

create or replace function public.claim_background_jobs(
  p_worker_id text,p_batch_size int default 10,p_lock_seconds int default 300,p_queue text default 'automation'
) returns setof public.background_jobs
language plpgsql security definer set search_path='' as $$
begin
  return query with candidates as (
    select id from public.background_jobs
    where queue=p_queue and status in ('queued','retry_scheduled') and available_at<=now()
      and (lock_expires_at is null or lock_expires_at<now()) and attempt_count<max_attempts
    order by priority desc,available_at,created_at
    for update skip locked limit greatest(1,least(p_batch_size,50))
  )
  update public.background_jobs j set status='running',worker_id=p_worker_id,locked_at=now(),
    lock_expires_at=now()+make_interval(secs=>greatest(30,least(p_lock_seconds,900))),fencing_token=gen_random_uuid(),
    attempt_count=j.attempt_count+1,updated_at=now()
  from candidates where j.id=candidates.id returning j.*;
end $$;

create or replace function public.recover_stale_background_jobs(
  p_limit int default 100
) returns table(requeued int,dead_lettered int)
language plpgsql security definer set search_path='' as $$
declare v_requeued int:=0;v_dead int:=0;
begin
  with stale as (
    select id from public.background_jobs
    where status='running' and lock_expires_at<now()
    order by lock_expires_at for update skip locked
    limit greatest(1,least(p_limit,500))
  ),updated as (
    update public.background_jobs j set
      status=case when j.attempt_count>=j.max_attempts then 'dead_letter' else 'retry_scheduled' end,
      available_at=case when j.attempt_count>=j.max_attempts then j.available_at else now() end,
      worker_id=null,locked_at=null,lock_expires_at=null,fencing_token=null,
      last_error_code='STALE_WORKER_LOCK',
      last_error_message='The worker lease expired before the job completed.',updated_at=now()
    from stale where j.id=stale.id returning j.status
  )
  select count(*) filter(where status='retry_scheduled'),count(*) filter(where status='dead_letter')
    into v_requeued,v_dead from updated;
  return query select v_requeued,v_dead;
end $$;

revoke all on function public.authorize_agent_tool_execution(uuid,text,numeric) from public,anon,authenticated;
revoke all on function public.extend_background_job_lease(uuid,text,uuid,int) from public,anon,authenticated;
revoke all on function public.recover_stale_background_jobs(int) from public,anon,authenticated;
revoke all on function public.decide_implementation_package(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_agent_tool_execution(uuid,text,numeric) to service_role;
grant execute on function public.extend_background_job_lease(uuid,text,uuid,int) to service_role;
grant execute on function public.recover_stale_background_jobs(int) to service_role;
grant execute on function public.decide_implementation_package(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) to service_role;

comment on table public.mutation_intents is
  'Immutable exact-action authorization ledger. All external mutations must be approved or policy-authorized here before execution.';
