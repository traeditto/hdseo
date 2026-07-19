-- Paid agency subscriptions and profit-safe managed-client capacity.

create table public.agency_subscriptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  plan_key text not null check(plan_key in ('launch','growth','scale')),
  status text not null default 'pending'
    check(status in ('pending','trialing','active','past_due','paused','canceled')),
  price_cents integer not null check(price_cents >= 0),
  currency char(3) not null default 'USD',
  included_client_limit integer not null check(included_client_limit >= 0),
  included_scale_client_limit integer not null default 0 check(included_scale_client_limit >= 0),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agency_id),
  unique(stripe_subscription_id)
);

create index agency_subscriptions_status_idx
  on public.agency_subscriptions(status,current_period_end);

alter table public.agency_subscriptions enable row level security;
create policy agency_subscriptions_read on public.agency_subscriptions
  for select to authenticated using(public.is_agency_member(agency_id));
create policy agency_subscriptions_owner_manage on public.agency_subscriptions
  for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner']::public.agency_role[]));

update public.agent_service_enrollments
set status='paused',pause_reason='Agency subscription required',updated_at=now()
where billing_owner='agency' and status in ('trialing','active')
  and not exists(
    select 1 from public.agency_subscriptions s
    where s.agency_id=agent_service_enrollments.agency_id
      and s.status in ('trialing','active')
  );

create or replace function public.claim_due_agent_service_enrollments(
  p_worker_id text,
  p_batch_size int default 10,
  p_lock_seconds int default 300
) returns setof public.agent_service_enrollments
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select e.id
    from public.agent_service_enrollments e
    where e.status in ('trialing','active')
      and e.service_mode='managed_agent'
      and e.next_cycle_at <= now()
      and (e.lock_expires_at is null or e.lock_expires_at < now())
      and (
        e.billing_owner='client'
        or exists(
          select 1 from public.agency_subscriptions s
          where s.agency_id=e.agency_id and s.status in ('trialing','active')
        )
      )
    order by e.next_cycle_at,e.created_at
    for update of e skip locked
    limit greatest(1,least(p_batch_size,50))
  )
  update public.agent_service_enrollments e
  set worker_id=p_worker_id,
      locked_at=now(),
      lock_expires_at=now()+make_interval(secs=>greatest(30,least(p_lock_seconds,1800))),
      updated_at=now()
  from due where e.id=due.id
  returning e.*;
end $$;

revoke all on function public.claim_due_agent_service_enrollments(text,int,int) from public,anon,authenticated;
grant execute on function public.claim_due_agent_service_enrollments(text,int,int) to service_role;
