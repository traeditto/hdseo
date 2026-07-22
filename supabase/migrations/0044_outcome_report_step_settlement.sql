-- Keep customer-facing Autopilot progress in lockstep with a completed
-- Reporting Agent. This also repairs reports that completed before the
-- application-side settlement was introduced.

create or replace function public.settle_completed_outcome_report_step()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_run_id uuid;
begin
  if new.status='succeeded'
    and old.status is distinct from 'succeeded'
    and new.source_type='outcome_loop'
    and new.work_type='reporting.summary'
    and coalesce(new.source_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_run_id:=new.source_id::uuid;

    update public.outcome_loop_steps s set
      status='succeeded',
      work_item_id=new.id,
      output=coalesce(new.final_outcome,'{}'::jsonb),
      validation=coalesce(new.validation_results,'{}'::jsonb),
      started_at=coalesce(s.started_at,new.started_at,new.created_at),
      completed_at=coalesce(new.completed_at,now()),
      updated_at=now()
    where s.run_id=v_run_id
      and s.agency_id=new.agency_id
      and s.project_id=new.project_id
      and s.step_key='report'
      and exists(
        select 1
        from public.outcome_loop_runs r
        join public.clients c
          on c.id=new.client_id
         and c.agency_id=new.agency_id
         and c.organization_id=r.client_organization_id
        where r.id=s.run_id
          and r.agency_id=s.agency_id
          and r.project_id=s.project_id
      );
  end if;
  return new;
end $$;

drop trigger if exists settle_completed_outcome_report_step
  on public.agent_work_items;
create trigger settle_completed_outcome_report_step
after update of status on public.agent_work_items
for each row execute function public.settle_completed_outcome_report_step();

-- One-time reconciliation for successful reports whose progress row was left
-- queued by the earlier worker ordering. The tenant and run relationship must
-- match before any row is changed.
with completed_reports as (
  select distinct on (
    case when coalesce(w.source_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then w.source_id::uuid end
  )
    case when coalesce(w.source_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then w.source_id::uuid end as run_id,
    w.id as work_item_id,
    w.agency_id,
    w.project_id,
    w.final_outcome,
    w.validation_results,
    w.started_at,
    w.created_at,
    w.completed_at
  from public.agent_work_items w
  join public.clients c
    on c.id=w.client_id
   and c.agency_id=w.agency_id
  join public.outcome_loop_runs r
    on r.id=case when coalesce(w.source_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then w.source_id::uuid end
   and r.agency_id=w.agency_id
   and r.project_id=w.project_id
   and r.client_organization_id=c.organization_id
  where w.status='succeeded'
    and w.source_type='outcome_loop'
    and w.work_type='reporting.summary'
    and coalesce(w.source_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  order by case when coalesce(w.source_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then w.source_id::uuid end,
    w.completed_at desc nulls last,w.updated_at desc
)
update public.outcome_loop_steps s set
  status='succeeded',
  work_item_id=cr.work_item_id,
  output=coalesce(cr.final_outcome,'{}'::jsonb),
  validation=coalesce(cr.validation_results,'{}'::jsonb),
  started_at=coalesce(s.started_at,cr.started_at,cr.created_at),
  completed_at=coalesce(cr.completed_at,now()),
  updated_at=now()
from completed_reports cr
where s.run_id=cr.run_id
  and s.agency_id=cr.agency_id
  and s.project_id=cr.project_id
  and s.step_key='report'
  and s.status is distinct from 'succeeded';

revoke all on function public.settle_completed_outcome_report_step()
  from public,anon,authenticated;
