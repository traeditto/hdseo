-- Reconcile the business-owner budget with the enforceable project ledger.
-- A budget is a hard ceiling, not a charge or authorization to spend.

create or replace function public.reconcile_project_working_budget()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_account_id uuid;
  v_limit numeric(14,2) := greatest(0,coalesce(new.monthly_budget,0));
begin
  if tg_op='UPDATE' then
    if new.monthly_budget is not distinct from old.monthly_budget then
      return new;
    end if;
  end if;

  insert into public.project_budget_accounts(
    agency_id,client_organization_id,project_id,monthly_limit,warning_percent,hard_stop,status,updated_at
  ) values(
    new.agency_id,new.client_organization_id,new.project_id,v_limit,80,true,'active',now()
  ) on conflict(project_id) do update set
    monthly_limit=excluded.monthly_limit,
    warning_percent=80,
    hard_stop=true,
    status='active',
    updated_at=now()
  returning id into v_account_id;

  insert into public.project_budget_allocations(
    agency_id,client_organization_id,project_id,budget_account_id,category,monthly_amount,approval_threshold,updated_at
  )
  select
    new.agency_id,new.client_organization_id,new.project_id,v_account_id,
    allocation.category,
    round(v_limit*allocation.percentage/100,2),
    case when allocation.category in ('content','authority') then 100 else 0 end,
    now()
  from (values
    ('data'::text,25::numeric),('content',20),('technical',15),('local',15),
    ('authority',10),('implementation',10),('software',5),('reserve',0)
  ) as allocation(category,percentage)
  on conflict(project_id,category) do update set
    budget_account_id=excluded.budget_account_id,
    monthly_amount=excluded.monthly_amount,
    approval_threshold=excluded.approval_threshold,
    updated_at=now();

  return new;
end $$;

drop trigger if exists client_growth_profile_budget_reconciliation on public.client_growth_profiles;
create trigger client_growth_profile_budget_reconciliation
after insert or update of monthly_budget on public.client_growth_profiles
for each row execute function public.reconcile_project_working_budget();

-- Existing owner workspaces already collected a monthly working ceiling during
-- onboarding. Provision the enforceable account without inventing spend.
insert into public.project_budget_accounts(
  agency_id,client_organization_id,project_id,monthly_limit,warning_percent,hard_stop,status,updated_at
)
select
  profile.agency_id,profile.client_organization_id,profile.project_id,
  greatest(0,coalesce(profile.monthly_budget,0)),80,true,'active',now()
from public.client_growth_profiles profile
on conflict(project_id) do nothing;

insert into public.project_budget_allocations(
  agency_id,client_organization_id,project_id,budget_account_id,category,monthly_amount,approval_threshold,updated_at
)
select
  account.agency_id,account.client_organization_id,account.project_id,account.id,
  allocation.category,
  round(account.monthly_limit*allocation.percentage/100,2),
  case when allocation.category in ('content','authority') then 100 else 0 end,
  now()
from public.project_budget_accounts account
cross join (values
  ('data'::text,25::numeric),('content',20),('technical',15),('local',15),
  ('authority',10),('implementation',10),('software',5),('reserve',0)
) as allocation(category,percentage)
where account.status='active'
on conflict(project_id,category) do nothing;

revoke all on function public.reconcile_project_working_budget() from public,anon,authenticated;
