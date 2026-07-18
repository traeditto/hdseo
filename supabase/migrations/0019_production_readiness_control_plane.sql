-- HD SEO production-readiness control plane.
-- A release is not considered production ready merely because its tables and
-- credentials exist. These records prove an entire client workflow and retain
-- the evidence required for launch approval.

create table public.production_acceptance_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  environment text not null default 'production' check (environment in ('staging','production')),
  status text not null default 'queued' check (status in ('queued','running','awaiting_approval','succeeded','failed','cancelled')),
  release_sha text,
  idempotency_key text not null,
  initiated_by uuid references auth.users(id) on delete set null,
  summary jsonb not null default '{}',
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id,idempotency_key),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.production_acceptance_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.production_acceptance_runs(id) on delete cascade,
  step_key text not null,
  title text not null,
  required boolean not null default true,
  status text not null default 'pending' check (status in ('pending','running','passed','warning','failed','blocked','skipped')),
  evidence jsonb not null default '{}',
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id,step_key)
);

create index production_acceptance_project_time_idx
  on public.production_acceptance_runs(project_id,created_at desc);
create index production_acceptance_status_time_idx
  on public.production_acceptance_runs(status,created_at desc);

alter table public.production_acceptance_runs enable row level security;
alter table public.production_acceptance_steps enable row level security;

create policy production_acceptance_runs_agency_read on public.production_acceptance_runs
  for select to authenticated using (public.is_agency_member(agency_id));
create policy production_acceptance_steps_agency_read on public.production_acceptance_steps
  for select to authenticated using (
    exists (
      select 1 from public.production_acceptance_runs run
      where run.id=public.production_acceptance_steps.run_id
        and public.is_agency_member(run.agency_id)
    )
  );

revoke insert,update,delete on public.production_acceptance_runs from anon,authenticated;
revoke insert,update,delete on public.production_acceptance_steps from anon,authenticated;

create or replace function public.create_production_acceptance_run(
  p_agency_id uuid,
  p_client_organization_id uuid,
  p_project_id uuid,
  p_environment text,
  p_release_sha text,
  p_idempotency_key text,
  p_initiated_by uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_run_id uuid;
begin
  if p_environment not in ('staging','production') then raise exception 'INVALID_ENVIRONMENT'; end if;
  if not exists (
    select 1 from public.seo_projects
    where id=p_project_id and agency_id=p_agency_id
      and client_organization_id=p_client_organization_id and status='active'
  ) then raise exception 'PROJECT_NOT_FOUND'; end if;

  insert into public.production_acceptance_runs(
    agency_id,client_organization_id,project_id,environment,release_sha,idempotency_key,initiated_by
  ) values (
    p_agency_id,p_client_organization_id,p_project_id,p_environment,p_release_sha,p_idempotency_key,p_initiated_by
  )
  on conflict(agency_id,idempotency_key) do update set updated_at=now()
  returning id into v_run_id;

  insert into public.production_acceptance_steps(run_id,step_key,title,required)
  values
    (v_run_id,'crawl','Collect fresh website evidence',true),
    (v_run_id,'search_console','Import Search Console evidence',true),
    (v_run_id,'opportunity','Discover and score an opportunity',true),
    (v_run_id,'agents','Complete supervised agent planning',true),
    (v_run_id,'approval','Record accountable human approval',true),
    (v_run_id,'implementation','Create the approved implementation',true),
    (v_run_id,'preview','Create a preview or CMS draft',true),
    (v_run_id,'qa','Pass automated live validation',true),
    (v_run_id,'production','Verify production publication',true),
    (v_run_id,'monitoring','Schedule outcome monitoring',true),
    (v_run_id,'reporting','Generate the client outcome report',true),
    (v_run_id,'rollback','Prove rollback readiness',true)
  on conflict(run_id,step_key) do nothing;

  return v_run_id;
end $$;

revoke all on function public.create_production_acceptance_run(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_production_acceptance_run(uuid,uuid,uuid,text,text,text,uuid) to service_role;
