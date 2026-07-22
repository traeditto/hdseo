-- Clear stale supervisor alerts after an independently verified outcome has
-- recovered. Outer scheduler failures do not always carry a cycle ID, so the
-- recovery transaction in 0042 could not identify those alerts by cycle alone.

create or replace function public.resolve_recovered_outcome_commit_alerts()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    update public.agent_service_escalations set
      status='resolved',
      resolution='Verified production delivery recovered and committed automatically.',
      resolved_at=now(),updated_at=now()
      where enrollment_id=new.enrollment_id
        and status='open'
        and escalation_type='worker'
        and coalesce(metadata->>'source','')='agent_service_outcome_loop'
        and (cycle_id=new.cycle_id or cycle_id is null)
        and summary in (
          'The verified outcome could not be committed to the usage ledger.',
          'The verified recovered outcome could not be committed to the usage ledger.'
        );
  end if;
  return new;
end $$;

drop trigger if exists resolve_recovered_outcome_commit_alerts
  on public.outcome_loop_runs;
create trigger resolve_recovered_outcome_commit_alerts
after update of status on public.outcome_loop_runs
for each row execute function public.resolve_recovered_outcome_commit_alerts();

-- One-time reconciliation for recoveries completed before this trigger was
-- installed. Only the exact obsolete commit error is resolved.
update public.agent_service_escalations e set
  status='resolved',
  resolution='Verified production delivery recovered and committed automatically.',
  resolved_at=now(),updated_at=now()
  where e.status='open'
    and e.escalation_type='worker'
    and coalesce(e.metadata->>'source','')='agent_service_outcome_loop'
    and e.summary in (
      'The verified outcome could not be committed to the usage ledger.',
      'The verified recovered outcome could not be committed to the usage ledger.'
    )
    and exists(
      select 1 from public.outcome_loop_runs r
      join public.billable_usage_reservations b on b.outcome_run_id=r.id
      where r.enrollment_id=e.enrollment_id
        and r.status='completed'
        and b.status='committed'
        and coalesce(b.metadata->>'verifiedRecovery','false')='true'
        and (e.cycle_id=r.cycle_id or e.cycle_id is null)
    );

revoke all on function public.resolve_recovered_outcome_commit_alerts()
  from public,anon,authenticated;
