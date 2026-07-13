-- Contain premium repository execution until the manual workflow is proven.
alter table public.agencies add column if not exists repository_execution_enabled boolean not null default false;
alter table public.seo_projects add column if not exists repository_execution_enabled boolean not null default false;
alter table public.seo_projects add column if not exists manual_workflow_verified_at timestamptz;

alter table public.seo_campaign_jobs add column if not exists total_claim_count int not null default 0;
alter table public.provider_operation_confirmations add column if not exists scope_hash text;
alter table public.provider_operation_confirmations add column if not exists consumed_at timestamptz;
create unique index if not exists provider_confirmation_scope_once on public.provider_operation_confirmations(id,scope_hash) where scope_hash is not null;

alter table public.seo_action_drafts drop constraint if exists seo_action_drafts_execution_path_check;
alter table public.seo_action_drafts add constraint seo_action_drafts_execution_path_check check(execution_path in ('repository','instruction','wordpress_package','generic_cms','developer_ticket'));

create or replace function public.claim_seo_campaign_job(p_worker_id text, p_lock_seconds int default 300)
returns setof public.seo_campaign_jobs language plpgsql security definer set search_path = '' as $$
begin return query with candidate as (
  select id from public.seo_campaign_jobs where status in ('queued','running','retry_scheduled') and next_attempt_at <= now()
  and (lock_expires_at is null or lock_expires_at < now()) and attempt_count < max_attempts
  order by created_at for update skip locked limit 1
) update public.seo_campaign_jobs j set status='running', worker_id=p_worker_id, locked_at=now(),
  lock_expires_at=now()+make_interval(secs=>p_lock_seconds), heartbeat_at=now(), total_claim_count=total_claim_count+1,
  started_at=coalesce(started_at,now()), updated_at=now()
from candidate where j.id=candidate.id returning j.*; end $$;
revoke all on function public.claim_seo_campaign_job(text,int) from public, anon, authenticated;
grant execute on function public.claim_seo_campaign_job(text,int) to service_role;
grant execute on function public.claim_seo_monitoring_checkpoint(text,int) to service_role;

create or replace function public.github_execution_readiness(target_agency uuid,target_project uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with state as (
    select a.repository_execution_enabled agency_enabled,p.repository_execution_enabled project_enabled,
      p.manual_workflow_verified_at,
      exists(select 1 from public.repository_connections r where r.project_id=p.id and r.status='connected' and r.installation_id is not null) repository_connected
    from public.seo_projects p join public.agencies a on a.id=p.agency_id
    where p.id=target_project and p.agency_id=target_agency
  ) select coalesce((select jsonb_build_object(
    'ready',agency_enabled and project_enabled and manual_workflow_verified_at is not null and repository_connected,
    'blockers',to_jsonb(array_remove(array[
      case when not agency_enabled then 'AGENCY_FEATURE_DISABLED' end,
      case when not project_enabled then 'PROJECT_FEATURE_DISABLED' end,
      case when manual_workflow_verified_at is null then 'MANUAL_WORKFLOW_NOT_VERIFIED' end,
      case when not repository_connected then 'REPOSITORY_NOT_VERIFIED' end
    ],null)),
    'completedRequirements',to_jsonb(array_remove(array[
      case when agency_enabled then 'AGENCY_FEATURE_ENABLED' end,
      case when project_enabled then 'PROJECT_FEATURE_ENABLED' end,
      case when manual_workflow_verified_at is not null then 'MANUAL_WORKFLOW_VERIFIED' end,
      case when repository_connected then 'REPOSITORY_VERIFIED' end
    ],null)),
    'recommendedNextStep',case
      when manual_workflow_verified_at is null then 'Complete and verify one non-repository implementation.'
      when not agency_enabled or not project_enabled then 'Enable repository execution through elevated administration.'
      when not repository_connected then 'Verify a GitHub App repository connection.'
      else 'Repository execution is eligible for human-approved use.' end
  ) from state),'{"ready":false,"blockers":["PROJECT_NOT_FOUND"],"completedRequirements":[],"recommendedNextStep":"Select a valid project."}'::jsonb) $$;
revoke all on function public.github_execution_readiness(uuid,uuid) from public,anon;
grant execute on function public.github_execution_readiness(uuid,uuid) to authenticated,service_role;

-- Clients receive only explicitly published records, never internal workflow rows.
create table public.client_portal_publications(
  id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,
  record_type text not null,source_id uuid,title text not null,summary text,status text not null,payload jsonb not null default '{}',
  published_by uuid references auth.users(id),published_at timestamptz not null default now(),revoked_at timestamptz,
  unique(project_id,record_type,source_id),
  foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
alter table public.client_portal_publications enable row level security;
create policy client_publications_read on public.client_portal_publications for select to authenticated
using(revoked_at is null and public.has_client_access(agency_id,client_organization_id));
create policy client_publications_agency_write on public.client_portal_publications for all to authenticated
using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','seo_strategist','account_manager']::public.agency_role[]))
with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','seo_strategist','account_manager']::public.agency_role[]));

drop policy if exists opportunities_access_read on public.seo_opportunities;
drop policy if exists drafts_access_read on public.seo_action_drafts;
drop policy if exists tasks_access_read on public.seo_tasks;
drop policy if exists seo_campaigns_tenant_read on public.seo_campaigns;
drop policy if exists seo_campaign_jobs_tenant_read on public.seo_campaign_jobs;
drop policy if exists repository_connections_tenant_read on public.repository_connections;
drop policy if exists seo_executions_tenant_read on public.seo_executions;
drop policy if exists seo_monitoring_plans_tenant_read on public.seo_monitoring_plans;
create policy opportunities_agency_read on public.seo_opportunities for select to authenticated using(public.is_agency_member(agency_id));
create policy drafts_agency_read on public.seo_action_drafts for select to authenticated using(public.is_agency_member(agency_id));
create policy tasks_agency_read on public.seo_tasks for select to authenticated using(public.is_agency_member(agency_id));
create policy campaigns_agency_read on public.seo_campaigns for select to authenticated using(public.is_agency_member(agency_id));
create policy jobs_agency_read on public.seo_campaign_jobs for select to authenticated using(public.is_agency_member(agency_id));
create policy repositories_agency_read on public.repository_connections for select to authenticated using(public.is_agency_member(agency_id));
create policy executions_agency_read on public.seo_executions for select to authenticated using(public.is_agency_member(agency_id));
create policy monitoring_plans_agency_read on public.seo_monitoring_plans for select to authenticated using(public.is_agency_member(agency_id));
