-- HD SEO autonomous, outcome-accountable operating loop.
-- This migration connects scheduled evidence collection, preview deployments,
-- economic opportunity selection, and post-change outcome recommendations.

alter table public.project_evidence_policies
  add column if not exists scheduling_enabled boolean not null default true,
  add column if not exists scheduling_interval_minutes int not null default 60
    check (scheduling_interval_minutes between 15 and 10080),
  add column if not exists next_scheduled_at timestamptz not null default now(),
  add column if not exists last_scheduled_at timestamptz;

create index if not exists project_evidence_policy_schedule_idx
  on public.project_evidence_policies(next_scheduled_at)
  where scheduling_enabled;

alter table public.seo_executions
  add column if not exists preview_deployment_id uuid references public.deployments(id) on delete set null,
  add column if not exists preview_url text,
  add column if not exists preview_validated_at timestamptz,
  add column if not exists outcome_recommendation text
    check (outcome_recommendation is null or outcome_recommendation in ('CONTINUE','KEEP','IMPROVE','ROLLBACK_RECOMMENDED')),
  add column if not exists outcome_summary jsonb not null default '{}';

create index if not exists seo_executions_preview_deployment_idx
  on public.seo_executions(preview_deployment_id)
  where preview_deployment_id is not null;

alter table public.seo_monitoring_plans
  add column if not exists baseline_outcomes jsonb not null default '{}',
  add column if not exists latest_outcomes jsonb not null default '{}',
  add column if not exists recommendation text
    check (recommendation is null or recommendation in ('CONTINUE','KEEP','IMPROVE','ROLLBACK_RECOMMENDED')),
  add column if not exists recommendation_reason text;

alter table public.seo_monitoring_checkpoints
  add column if not exists outcome_evidence jsonb not null default '{}',
  add column if not exists recommendation text
    check (recommendation is null or recommendation in ('CONTINUE','KEEP','IMPROVE','ROLLBACK_RECOMMENDED'));

create or replace function public.claim_due_evidence_policies(
  p_worker_id text,
  p_batch_size int default 25
) returns setof public.project_evidence_policies
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select id
    from public.project_evidence_policies
    where scheduling_enabled and next_scheduled_at <= now()
    order by next_scheduled_at, updated_at
    for update skip locked
    limit greatest(1,least(p_batch_size,100))
  )
  update public.project_evidence_policies p
  set last_scheduled_at=now(),
      next_scheduled_at=now()+make_interval(mins=>p.scheduling_interval_minutes),
      updated_at=now()
  from due
  where p.id=due.id
  returning p.*;
end $$;

create or replace function public.recover_stale_background_jobs(
  p_limit int default 100
) returns table(requeued int, dead_lettered int)
language plpgsql security definer set search_path = '' as $$
declare v_requeued int := 0; v_dead int := 0;
begin
  with stale as (
    select id
    from public.background_jobs
    where status='running' and lock_expires_at < now()
    order by lock_expires_at
    for update skip locked
    limit greatest(1,least(p_limit,500))
  ), updated as (
    update public.background_jobs j
    set status=case when j.attempt_count>=j.max_attempts then 'dead_letter' else 'retry_scheduled' end,
        available_at=case when j.attempt_count>=j.max_attempts then j.available_at else now() end,
        worker_id=null, locked_at=null, lock_expires_at=null,
        last_error_code='STALE_WORKER_LOCK',
        last_error_message='The worker lease expired before the job completed.',
        updated_at=now()
    from stale where j.id=stale.id
    returning j.status
  )
  select count(*) filter(where status='retry_scheduled'),count(*) filter(where status='dead_letter')
  into v_requeued,v_dead from updated;
  return query select v_requeued,v_dead;
end $$;

revoke all on function public.claim_due_evidence_policies(text,int) from public,anon,authenticated;
revoke all on function public.recover_stale_background_jobs(int) from public,anon,authenticated;
grant execute on function public.claim_due_evidence_policies(text,int) to service_role;
grant execute on function public.recover_stale_background_jobs(int) to service_role;
