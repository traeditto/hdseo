alter table public.seo_opportunities add column opportunity_key text;
alter table public.seo_opportunities add column target_url text;
alter table public.seo_opportunities add column cooldown_until timestamptz;
alter table public.seo_opportunities add column first_detected_at timestamptz not null default now();
create unique index seo_active_opportunity_key on public.seo_opportunities(project_id, opportunity_key) where opportunity_key is not null and status in ('open','approved','in_progress','monitoring');

create table public.seo_campaigns (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  name text not null, status text not null default 'draft' check(status in ('draft','active','paused','completed','cancelled','budget_paused','error')),
  automation_mode text not null default 'PREPARE' check(automation_mode in ('MONITOR','RECOMMEND','PREPARE','EXECUTE_WITH_APPROVAL')),
  risk_tolerance text not null default 'balanced', monthly_budget numeric(12,2) not null default 0, data_budget numeric(12,2) not null default 0,
  implementation_budget numeric(12,2) not null default 0, reserve_budget numeric(12,2) not null default 0,
  constraints jsonb not null default '{}', business_economics jsonb not null default '{}', assumptions jsonb not null default '{}',
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(agency_id, client_organization_id, project_id, id),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_campaign_jobs (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  campaign_id uuid references public.seo_campaigns(id) on delete set null, requested_by uuid not null references auth.users(id),
  status text not null default 'queued', current_stage text not null default 'validate', last_completed_stage text, progress_percent int not null default 0 check(progress_percent between 0 and 100),
  input jsonb not null default '{}', stage_data jsonb not null default '{}', result jsonb not null default '{}',
  error_code text, error_message text, error_details jsonb not null default '{}', reference_id text not null unique, idempotency_key text not null unique,
  attempt_count int not null default 0, max_attempts int not null default 3, worker_id text, locked_at timestamptz, lock_expires_at timestamptz,
  heartbeat_at timestamptz, next_attempt_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz, failed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_campaign_candidates (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.seo_campaign_jobs(id) on delete cascade,
  opportunity_id uuid not null references public.seo_opportunities(id) on delete cascade,
  eligibility_status text not null check(eligibility_status in ('eligible','selected','deferred','blocked')),
  score int not null check(score between 0 and 100), confidence int not null check(confidence between 0 and 100), target_milestone text,
  score_breakdown jsonb not null default '{}', evidence jsonb not null default '{}', missing_evidence jsonb not null default '[]',
  selection_reason text, deferred_reason text, created_at timestamptz not null default now(), unique(job_id, opportunity_id)
);

create table public.repository_connections (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  provider text not null default 'github', repository_owner text not null, repository_name text not null, default_branch text not null default 'main',
  installation_id bigint, encrypted_secret_reference text, status text not null default 'connection_required', last_verified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(project_id, provider),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_executions (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  campaign_id uuid references public.seo_campaigns(id) on delete set null, opportunity_id uuid not null references public.seo_opportunities(id) on delete restrict,
  action_draft_id uuid references public.seo_action_drafts(id) on delete restrict, repository_connection_id uuid references public.repository_connections(id) on delete restrict,
  status text not null default 'planning', action_type public.seo_action_type not null, base_branch text, base_commit_sha text, branch_name text,
  pull_request_number int, pull_request_url text, merge_commit_sha text, production_commit_sha text, production_deployed_at timestamptz,
  validation_results jsonb not null default '{}', created_by uuid not null references auth.users(id), approved_at timestamptz, executed_at timestamptz, merged_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_execution_files (
  id uuid primary key default gen_random_uuid(), execution_id uuid not null references public.seo_executions(id) on delete cascade,
  file_path text not null, change_type text not null check(change_type in ('MODIFY_FILE','CREATE_FILE')), original_sha text,
  original_content text, proposed_content text not null, human_edited_content text, approved_content text, diff text not null,
  reason text not null, evidence jsonb not null default '{}', status text not null default 'proposed', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(execution_id, file_path)
);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(), provider text not null, delivery_id text not null, event_type text,
  signature_valid boolean not null, payload_hash text not null, processed_at timestamptz, created_at timestamptz not null default now(), unique(provider, delivery_id)
);

create table public.seo_deployments (
  id uuid primary key default gen_random_uuid(), execution_id uuid not null references public.seo_executions(id) on delete cascade,
  provider text not null, environment text not null, commit_sha text not null, deployment_id text, deployment_url text,
  status text not null, error_details jsonb not null default '{}', started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(provider, environment, commit_sha)
);

create table public.seo_monitoring_plans (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  execution_id uuid not null unique references public.seo_executions(id) on delete cascade, opportunity_id uuid not null references public.seo_opportunities(id) on delete cascade,
  keyword_id uuid references public.seo_keywords(id) on delete set null, target_url text not null, baseline_position int, baseline_ranking_url text,
  target_milestone text, implementation_date date not null, checkpoint_days int[] not null default array[7,14,30,60,90],
  status text not null default 'scheduled', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_monitoring_checkpoints (
  id uuid primary key default gen_random_uuid(), monitoring_plan_id uuid not null references public.seo_monitoring_plans(id) on delete cascade,
  checkpoint_day int not null check(checkpoint_day in (7,14,30,60,90)), due_at timestamptz not null, collected_at timestamptz,
  position int, ranking_url text, maps_position int, status text not null default 'scheduled', decision text,
  evidence jsonb not null default '{}', error_details jsonb not null default '{}', worker_id text, locked_at timestamptz, lock_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(monitoring_plan_id, checkpoint_day)
);

create or replace function public.claim_seo_campaign_job(p_worker_id text, p_lock_seconds int default 300)
returns setof public.seo_campaign_jobs language plpgsql security definer set search_path = '' as $$
begin return query with candidate as (
  select id from public.seo_campaign_jobs where status in ('queued','running','retry_scheduled') and next_attempt_at <= now()
  and (lock_expires_at is null or lock_expires_at < now()) and attempt_count < max_attempts
  order by created_at for update skip locked limit 1
) update public.seo_campaign_jobs j set status='running', worker_id=p_worker_id, locked_at=now(), lock_expires_at=now()+make_interval(secs=>p_lock_seconds), heartbeat_at=now(), attempt_count=attempt_count+1, started_at=coalesce(started_at,now()), updated_at=now() from candidate where j.id=candidate.id returning j.*; end $$;
revoke all on function public.claim_seo_campaign_job(text,int) from public, anon, authenticated;

create or replace function public.claim_seo_monitoring_checkpoint(p_worker_id text, p_lock_seconds int default 300)
returns setof public.seo_monitoring_checkpoints language plpgsql security definer set search_path = '' as $$
begin return query with candidate as (
  select id from public.seo_monitoring_checkpoints where status in ('scheduled','due','failed') and due_at <= now()
  and (lock_expires_at is null or lock_expires_at < now()) order by due_at for update skip locked limit 1
) update public.seo_monitoring_checkpoints c set status='collecting', worker_id=p_worker_id, locked_at=now(), lock_expires_at=now()+make_interval(secs=>p_lock_seconds), updated_at=now() from candidate where c.id=candidate.id returning c.*; end $$;
revoke all on function public.claim_seo_monitoring_checkpoint(text,int) from public, anon, authenticated;

create unique index one_active_job_per_project on public.seo_campaign_jobs(project_id) where status not in ('completed','failed','cancelled','stale');
create index campaign_job_queue on public.seo_campaign_jobs(status, next_attempt_at, lock_expires_at);
create index monitoring_due on public.seo_monitoring_checkpoints(status, due_at);
