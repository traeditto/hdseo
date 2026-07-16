-- HD SEO enterprise automation control plane.
-- This migration is additive: existing campaign/execution tables remain the source
-- for the original SEO workflow while these tables coordinate external systems.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  organization_id uuid not null unique references public.client_organizations(id) on delete cascade,
  name text not null,
  external_key text,
  status text not null default 'active' check (status in ('onboarding','active','paused','archived')),
  white_label_config jsonb not null default '{}',
  automation_config jsonb not null default '{"approvalRequired":true,"autoRollback":true}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, external_key)
);

insert into public.clients(id,agency_id,organization_id,name,status,created_at,updated_at)
select id,agency_id,id,name,status,created_at,updated_at from public.client_organizations
on conflict (organization_id) do nothing;

create or replace function public.sync_enterprise_client()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.clients(id,agency_id,organization_id,name,status,created_at,updated_at)
  values(new.id,new.agency_id,new.id,new.name,new.status,new.created_at,new.updated_at)
  on conflict (organization_id) do update set name=excluded.name,status=excluded.status,updated_at=excluded.updated_at;
  return new;
end $$;

create trigger sync_enterprise_client_after_write
after insert or update of name,status on public.client_organizations
for each row execute function public.sync_enterprise_client();

create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  installation_id bigint not null unique,
  account_id bigint not null,
  account_login text not null,
  account_type text not null check (account_type in ('User','Organization','Enterprise','Bot')),
  repository_selection text not null check (repository_selection in ('all','selected')),
  permissions jsonb not null default '{}',
  events jsonb not null default '[]',
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  installed_by uuid references auth.users(id) on delete set null,
  suspended_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  github_installation_id uuid not null references public.github_installations(id) on delete restrict,
  github_repository_id bigint not null,
  owner text not null,
  name text not null,
  full_name text not null,
  default_branch text not null default 'main',
  visibility text not null default 'private' check (visibility in ('public','private','internal')),
  status text not null default 'active' check (status in ('active','disabled','archived','installation_suspended')),
  repository_execution_enabled boolean not null default false,
  metadata jsonb not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (github_installation_id, github_repository_id),
  unique (project_id, full_name)
);

create table public.vercel_connections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  team_id text,
  team_slug text,
  configuration_id text,
  scope_key text generated always as (coalesce(team_id,'personal')) stored,
  account_type text not null default 'team' check (account_type in ('personal','team')),
  encrypted_access_token text not null,
  token_key_version smallint not null default 1,
  scopes jsonb not null default '[]',
  status text not null default 'active' check (status in ('active','revoked','error')),
  connected_by uuid references auth.users(id) on delete set null,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vercel_connections add constraint vercel_connections_agency_scope_unique unique(agency_id,scope_key);
create unique index vercel_connections_configuration_unique on public.vercel_connections(configuration_id) where configuration_id is not null;

create table public.vercel_projects (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  connection_id uuid not null references public.vercel_connections(id) on delete restrict,
  repository_id uuid references public.repositories(id) on delete set null,
  vercel_project_id text not null,
  name text not null,
  framework text,
  root_directory text,
  production_branch text not null default 'main',
  production_domains text[] not null default '{}',
  environment_config jsonb not null default '{}',
  status text not null default 'active' check (status in ('active','disabled','deleted')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, vercel_project_id),
  unique (project_id, vercel_project_id)
);

create table public.seo_jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  repository_id uuid references public.repositories(id) on delete restrict,
  job_type text not null check (job_type in ('seo_change','deploy','validate','rollback','sync_integration')),
  status text not null default 'queued' check (status in ('queued','running','waiting','succeeded','failed','cancelled')),
  priority smallint not null default 50 check (priority between 0 and 100),
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  requested_by uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, idempotency_key)
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  seo_job_id uuid not null references public.seo_jobs(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','waiting','succeeded','failed','cancelled')),
  current_stage text not null default 'queued',
  trace_id uuid not null default gen_random_uuid() unique,
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.deployments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  vercel_project_id uuid not null references public.vercel_projects(id) on delete restrict,
  repository_id uuid references public.repositories(id) on delete set null,
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  external_deployment_id text,
  environment text not null check (environment in ('preview','staging','production')),
  git_ref text not null,
  git_sha text,
  url text,
  status text not null default 'queued' check (status in ('queued','creating','building','ready','validating','healthy','failed','cancelled','rolling_back','rolled_back')),
  previous_deployment_id uuid references public.deployments(id) on delete set null,
  rollback_of_id uuid references public.deployments(id) on delete set null,
  triggered_by uuid references auth.users(id) on delete set null,
  provider_metadata jsonb not null default '{}',
  validation_summary jsonb not null default '{}',
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index deployments_external_unique on public.deployments(vercel_project_id,external_deployment_id) where external_deployment_id is not null;

create table public.deploy_logs (
  id bigint generated always as identity primary key,
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  sequence bigint not null,
  source text not null check (source in ('hdseo','github','vercel','health_check','lighthouse','seo_validator')),
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  message text not null,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  unique (deployment_id, source, sequence)
);

create table public.deployment_checks (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  check_type text not null check (check_type in ('health','lighthouse','seo','schema','sitemap','robots','indexing_readiness')),
  status text not null check (status in ('pending','running','passed','warning','failed','skipped')),
  required boolean not null default true,
  score numeric(6,2),
  details jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deployment_id, check_type)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github','vercel')),
  delivery_id text not null,
  agency_id uuid references public.agencies(id) on delete cascade,
  event_type text not null,
  action text,
  payload_hash text not null,
  payload jsonb not null default '{}',
  signature_valid boolean not null,
  status text not null default 'received' check (status in ('received','processing','processed','ignored','failed')),
  attempt_count int not null default 0,
  error_code text,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, delivery_id)
);

create table public.integration_oauth_states (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('github','vercel')),
  provider_user_id text,
  encrypted_access_token text not null,
  context jsonb not null default '{}',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  queue text not null default 'automation',
  job_type text not null,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  automation_run_id uuid references public.automation_runs(id) on delete cascade,
  deployment_id uuid references public.deployments(id) on delete cascade,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','retry_scheduled','succeeded','failed','cancelled','dead_letter')),
  priority smallint not null default 50 check (priority between 0 and 100),
  available_at timestamptz not null default now(),
  attempt_count int not null default 0,
  max_attempts int not null default 8 check (max_attempts between 1 and 25),
  worker_id text,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  idempotency_key text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (queue, idempotency_key)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user','system','github','vercel')),
  action text not null,
  resource_type text not null,
  resource_id text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}',
  trace_id uuid,
  ip_hash text,
  user_agent text,
  occurred_at timestamptz not null default now()
);

create table public.rate_limit_buckets (
  scope_key text not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count int not null default 0,
  request_limit int not null,
  expires_at timestamptz not null,
  primary key (scope_key, action, window_started_at)
);

create index clients_agency_status_idx on public.clients(agency_id,status);
create index github_installations_agency_status_idx on public.github_installations(agency_id,status);
create index repositories_project_status_idx on public.repositories(project_id,status);
create index repositories_agency_name_idx on public.repositories(agency_id,full_name);
create index vercel_projects_project_status_idx on public.vercel_projects(project_id,status);
create index seo_jobs_project_created_idx on public.seo_jobs(project_id,created_at desc);
create index automation_runs_job_created_idx on public.automation_runs(seo_job_id,created_at desc);
create index deployments_project_created_idx on public.deployments(project_id,created_at desc);
create index deployments_status_created_idx on public.deployments(status,created_at);
create index deploy_logs_deployment_time_idx on public.deploy_logs(deployment_id,occurred_at);
create index webhook_events_status_received_idx on public.webhook_events(status,received_at);
create index integration_oauth_states_expiry_idx on public.integration_oauth_states(expires_at) where consumed_at is null;
create index background_jobs_claim_idx on public.background_jobs(queue,status,available_at,priority desc) where status in ('queued','retry_scheduled');
create index background_jobs_lock_idx on public.background_jobs(lock_expires_at) where status='running';
create index audit_events_agency_time_idx on public.audit_events(agency_id,occurred_at desc);
create index rate_limit_expiry_idx on public.rate_limit_buckets(expires_at);

create or replace function public.enqueue_deployment_job(
  p_agency_id uuid,p_client_organization_id uuid,p_project_id uuid,p_repository_id uuid,p_vercel_project_id uuid,
  p_requested_by uuid,p_environment text,p_git_ref text,p_git_sha text,p_idempotency_key text,p_priority int default 50
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client_id uuid;v_job_id uuid;v_run_id uuid;v_deployment_id uuid;
begin
  select id into v_client_id from public.clients where agency_id=p_agency_id and organization_id=p_client_organization_id;
  if v_client_id is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not exists(select 1 from public.repositories where id=p_repository_id and agency_id=p_agency_id and client_id=v_client_id and project_id=p_project_id and status='active' and repository_execution_enabled) then raise exception 'REPOSITORY_NOT_READY'; end if;
  if not exists(select 1 from public.vercel_projects where id=p_vercel_project_id and agency_id=p_agency_id and client_id=v_client_id and project_id=p_project_id and repository_id=p_repository_id and status='active') then raise exception 'VERCEL_PROJECT_NOT_READY'; end if;
  select id into v_job_id from public.seo_jobs where agency_id=p_agency_id and idempotency_key=p_idempotency_key;
  if v_job_id is not null then
    select id into v_run_id from public.automation_runs where seo_job_id=v_job_id order by created_at limit 1;
    select id into v_deployment_id from public.deployments where automation_run_id=v_run_id order by created_at limit 1;
    return jsonb_build_object('jobId',v_job_id,'runId',v_run_id,'deploymentId',v_deployment_id,'duplicate',true);
  end if;
  insert into public.seo_jobs(agency_id,client_id,project_id,repository_id,job_type,status,priority,input,requested_by,idempotency_key)
    values(p_agency_id,v_client_id,p_project_id,p_repository_id,'deploy','queued',p_priority,jsonb_build_object('environment',p_environment,'gitRef',p_git_ref,'gitSha',p_git_sha),p_requested_by,p_idempotency_key) returning id into v_job_id;
  insert into public.automation_runs(agency_id,seo_job_id,status,current_stage,input)
    values(p_agency_id,v_job_id,'queued','deploy.create',jsonb_build_object('environment',p_environment,'gitRef',p_git_ref,'gitSha',p_git_sha)) returning id into v_run_id;
  insert into public.deployments(agency_id,client_id,project_id,vercel_project_id,repository_id,automation_run_id,environment,git_ref,git_sha,status,triggered_by)
    values(p_agency_id,v_client_id,p_project_id,p_vercel_project_id,p_repository_id,v_run_id,p_environment,p_git_ref,p_git_sha,'queued',p_requested_by) returning id into v_deployment_id;
  insert into public.background_jobs(queue,job_type,agency_id,automation_run_id,deployment_id,payload,status,priority,idempotency_key)
    values('deployments','deployment.create',p_agency_id,v_run_id,v_deployment_id,'{}','queued',p_priority,'deployment.create:'||v_deployment_id);
  return jsonb_build_object('jobId',v_job_id,'runId',v_run_id,'deploymentId',v_deployment_id,'duplicate',false);
end $$;

create or replace function public.enqueue_rollback_job(
  p_agency_id uuid,p_source_deployment_id uuid,p_target_deployment_id uuid,p_requested_by uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_source public.deployments;v_target public.deployments;v_job_id uuid;v_run_id uuid;v_deployment_id uuid;
begin
  select * into v_source from public.deployments where id=p_source_deployment_id and agency_id=p_agency_id and environment='production';
  select * into v_target from public.deployments where id=p_target_deployment_id and agency_id=p_agency_id and environment='production' and status in ('healthy','ready','rolled_back');
  if v_source.id is null or v_target.id is null or v_source.project_id<>v_target.project_id or v_target.external_deployment_id is null then raise exception 'ROLLBACK_TARGET_INVALID'; end if;
  select id into v_job_id from public.seo_jobs where agency_id=p_agency_id and idempotency_key=p_idempotency_key;
  if v_job_id is not null then
    select id into v_run_id from public.automation_runs where seo_job_id=v_job_id order by created_at limit 1;
    select id into v_deployment_id from public.deployments where automation_run_id=v_run_id order by created_at limit 1;
    return jsonb_build_object('jobId',v_job_id,'runId',v_run_id,'deploymentId',v_deployment_id,'duplicate',true);
  end if;
  insert into public.seo_jobs(agency_id,client_id,project_id,repository_id,job_type,status,input,requested_by,idempotency_key)
    values(p_agency_id,v_source.client_id,v_source.project_id,v_source.repository_id,'rollback','queued',jsonb_build_object('sourceDeploymentId',v_source.id,'targetDeploymentId',v_target.id),p_requested_by,p_idempotency_key) returning id into v_job_id;
  insert into public.automation_runs(agency_id,seo_job_id,status,current_stage,input)
    values(p_agency_id,v_job_id,'queued','deployment.rollback',jsonb_build_object('sourceDeploymentId',v_source.id,'targetDeploymentId',v_target.id)) returning id into v_run_id;
  insert into public.deployments(agency_id,client_id,project_id,vercel_project_id,repository_id,automation_run_id,environment,git_ref,git_sha,status,previous_deployment_id,rollback_of_id,triggered_by,provider_metadata)
    values(p_agency_id,v_source.client_id,v_source.project_id,v_source.vercel_project_id,v_source.repository_id,v_run_id,'production',v_target.git_ref,v_target.git_sha,'queued',v_target.id,v_source.id,p_requested_by,jsonb_build_object('targetExternalDeploymentId',v_target.external_deployment_id)) returning id into v_deployment_id;
  insert into public.background_jobs(queue,job_type,agency_id,automation_run_id,deployment_id,payload,status,priority,idempotency_key)
    values('deployments','deployment.rollback',p_agency_id,v_run_id,v_deployment_id,jsonb_build_object('sourceDeploymentId',v_source.id,'targetDeploymentId',v_target.id),'queued',100,'deployment.rollback:'||v_deployment_id);
  return jsonb_build_object('jobId',v_job_id,'runId',v_run_id,'deploymentId',v_deployment_id,'duplicate',false);
end $$;

create or replace function public.claim_background_jobs(p_worker_id text,p_batch_size int default 10,p_lock_seconds int default 300,p_queue text default 'automation')
returns setof public.background_jobs language plpgsql security definer set search_path = '' as $$
begin
  return query with candidates as (
    select id from public.background_jobs
    where queue=p_queue and status in ('queued','retry_scheduled') and available_at<=now()
      and (lock_expires_at is null or lock_expires_at<now()) and attempt_count<max_attempts
    order by priority desc,available_at,created_at
    for update skip locked limit greatest(1,least(p_batch_size,50))
  )
  update public.background_jobs j set status='running',worker_id=p_worker_id,locked_at=now(),
    lock_expires_at=now()+make_interval(secs=>p_lock_seconds),attempt_count=j.attempt_count+1,updated_at=now()
  from candidates where j.id=candidates.id returning j.*;
end $$;

create or replace function public.consume_rate_limit(p_scope_key text,p_action text,p_limit int,p_window_seconds int)
returns table(allowed boolean,remaining int,reset_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
  v_count int;
begin
  insert into public.rate_limit_buckets(scope_key,action,window_started_at,request_count,request_limit,expires_at)
  values(p_scope_key,p_action,v_window,1,p_limit,v_window+make_interval(secs=>p_window_seconds))
  on conflict(scope_key,action,window_started_at) do update
    set request_count=public.rate_limit_buckets.request_count+1,request_limit=excluded.request_limit
  returning request_count into v_count;
  return query select v_count<=p_limit,greatest(0,p_limit-v_count),v_window+make_interval(secs=>p_window_seconds);
end $$;

revoke all on function public.claim_background_jobs(text,int,int,text) from public,anon,authenticated;
revoke all on function public.consume_rate_limit(text,text,int,int) from public,anon,authenticated;
revoke all on function public.enqueue_deployment_job(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,int) from public,anon,authenticated;
revoke all on function public.enqueue_rollback_job(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_background_jobs(text,int,int,text) to service_role;
grant execute on function public.consume_rate_limit(text,text,int,int) to service_role;
grant execute on function public.enqueue_deployment_job(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,int) to service_role;
grant execute on function public.enqueue_rollback_job(uuid,uuid,uuid,uuid,text) to service_role;

do $$ declare t text; begin
  foreach t in array array['clients','github_installations','repositories','vercel_connections','vercel_projects','seo_jobs','automation_runs','deployments','deploy_logs','deployment_checks','webhook_events','integration_oauth_states','background_jobs','audit_events','rate_limit_buckets'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

create policy clients_tenant_read on public.clients for select to authenticated using(public.has_client_access(agency_id,organization_id));
create policy github_installations_admin on public.github_installations for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy repositories_member_read on public.repositories for select to authenticated using(public.is_agency_member(agency_id));
create policy repositories_admin_write on public.repositories for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','developer']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','developer']::public.agency_role[]));
create policy vercel_connections_admin on public.vercel_connections for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy vercel_projects_member_read on public.vercel_projects for select to authenticated using(public.is_agency_member(agency_id));
create policy vercel_projects_admin_write on public.vercel_projects for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','developer']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','developer']::public.agency_role[]));

do $$ declare t text; begin
  foreach t in array array['seo_jobs','automation_runs','deployments'] loop
    execute format('create policy %I_member_read on public.%I for select to authenticated using(public.is_agency_member(agency_id))',t,t);
  end loop;
end $$;

create policy deploy_logs_member_read on public.deploy_logs for select to authenticated using(exists(select 1 from public.deployments d where d.id=deployment_id and public.is_agency_member(d.agency_id)));
create policy deployment_checks_member_read on public.deployment_checks for select to authenticated using(exists(select 1 from public.deployments d where d.id=deployment_id and public.is_agency_member(d.agency_id)));
create policy audit_events_admin_read on public.audit_events for select to authenticated using(public.has_agency_role(agency_id,array['agency_owner','agency_admin']::public.agency_role[]));

revoke all on public.webhook_events,public.background_jobs,public.rate_limit_buckets from anon,authenticated;
revoke all on public.integration_oauth_states from anon,authenticated;
revoke select (encrypted_access_token) on table public.vercel_connections from anon,authenticated;
