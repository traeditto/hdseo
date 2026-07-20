-- Self-service retail trial.
-- A verified business account receives one bounded public website crawl.
-- Trial consumption is serialized in Postgres so repeated clicks, concurrent
-- requests, and multiple application instances cannot create free crawl spend.

create table public.client_trial_entitlements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  benefit_key text not null check (benefit_key in ('website_crawl')),
  allowance smallint not null default 1 check (allowance between 0 and 10),
  used_count smallint not null default 0 check (used_count >= 0 and used_count <= allowance),
  status text not null default 'active' check (status in ('active','exhausted','expired','converted')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,benefit_key),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.client_trial_usage (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references public.client_trial_entitlements(id) on delete cascade,
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  benefit_key text not null check (benefit_key in ('website_crawl')),
  idempotency_key text not null,
  status text not null default 'claimed' check (status in ('claimed','queued','succeeded','failed')),
  background_job_id uuid references public.background_jobs(id) on delete set null,
  failure_code text,
  claimed_at timestamptz not null default now(),
  queued_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(project_id,benefit_key,idempotency_key),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create index client_trial_entitlements_status_idx
  on public.client_trial_entitlements(status,expires_at);
create index client_trial_usage_job_idx
  on public.client_trial_usage(background_job_id) where background_job_id is not null;

alter table public.client_trial_entitlements enable row level security;
alter table public.client_trial_usage enable row level security;

create policy client_trial_entitlements_read on public.client_trial_entitlements
  for select to authenticated
  using(public.has_client_access(agency_id,client_organization_id) or public.is_agency_member(agency_id));
create policy client_trial_usage_read on public.client_trial_usage
  for select to authenticated
  using(public.has_client_access(agency_id,client_organization_id) or public.is_agency_member(agency_id));

grant select on public.client_trial_entitlements,public.client_trial_usage to authenticated;
revoke all on public.client_trial_entitlements,public.client_trial_usage from anon;

create or replace function public.ensure_client_free_trial_entitlement()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.plan_key='free_audit' and new.status='trialing' then
    insert into public.client_trial_entitlements(
      agency_id,client_organization_id,project_id,benefit_key,allowance,used_count,status,expires_at
    ) values(
      new.agency_id,new.client_organization_id,new.project_id,'website_crawl',1,0,'active',new.trial_ends_at
    ) on conflict(project_id,benefit_key) do update set
      expires_at=excluded.expires_at,
      status=case
        when public.client_trial_entitlements.used_count>=public.client_trial_entitlements.allowance then 'exhausted'
        when excluded.expires_at is not null and excluded.expires_at<=now() then 'expired'
        else 'active'
      end,
      updated_at=now();
  elsif new.plan_key<>'free_audit' and new.status in ('trialing','active') then
    update public.client_trial_entitlements
    set status='converted',updated_at=now()
    where project_id=new.project_id and status<>'converted';
  end if;
  return new;
end $$;

drop trigger if exists client_subscription_trial_entitlement on public.client_subscriptions;
create trigger client_subscription_trial_entitlement
after insert or update of plan_key,status,trial_ends_at on public.client_subscriptions
for each row execute function public.ensure_client_free_trial_entitlement();

-- Backfill current retail trials. A previously queued or completed crawl counts
-- as the included crawl so reconciliation cannot accidentally grant another.
insert into public.client_trial_entitlements(
  agency_id,client_organization_id,project_id,benefit_key,allowance,used_count,status,expires_at,last_used_at
)
select
  s.agency_id,s.client_organization_id,s.project_id,'website_crawl',1,
  case when exists(
    select 1 from public.background_jobs j
    where j.project_id=s.project_id and j.job_type='crawler.crawl'
  ) then 1 else 0 end,
  case
    when s.trial_ends_at is not null and s.trial_ends_at<=now() then 'expired'
    when exists(select 1 from public.background_jobs j where j.project_id=s.project_id and j.job_type='crawler.crawl') then 'exhausted'
    else 'active'
  end,
  s.trial_ends_at,
  (select max(j.created_at) from public.background_jobs j where j.project_id=s.project_id and j.job_type='crawler.crawl')
from public.client_subscriptions s
where s.plan_key='free_audit'
on conflict(project_id,benefit_key) do nothing;

create or replace function public.claim_client_website_crawl(
  p_project_id uuid,
  p_idempotency_key text
) returns table(decision text,usage_id uuid,remaining smallint)
language plpgsql security definer set search_path = '' as $$
declare
  v_subscription public.client_subscriptions%rowtype;
  v_entitlement public.client_trial_entitlements%rowtype;
  v_usage public.client_trial_usage%rowtype;
begin
  select * into v_subscription
  from public.client_subscriptions
  where project_id=p_project_id
  for update;

  -- Agency-managed projects may not use retail subscriptions and remain under
  -- their existing agency plan, rate limits, and provider-spend controls.
  if not found then
    return query select 'managed'::text,null::uuid,null::smallint;
    return;
  end if;

  if v_subscription.plan_key<>'free_audit' and v_subscription.status in ('trialing','active') then
    return query select 'paid'::text,null::uuid,null::smallint;
    return;
  end if;

  if v_subscription.plan_key<>'free_audit' or v_subscription.status<>'trialing' then
    return query select 'not_eligible'::text,null::uuid,0::smallint;
    return;
  end if;

  if v_subscription.trial_ends_at is not null and v_subscription.trial_ends_at<=now() then
    update public.client_trial_entitlements set status='expired',updated_at=now()
    where project_id=p_project_id and benefit_key='website_crawl';
    return query select 'expired'::text,null::uuid,0::smallint;
    return;
  end if;

  insert into public.client_trial_entitlements(
    agency_id,client_organization_id,project_id,benefit_key,allowance,used_count,status,expires_at
  ) values(
    v_subscription.agency_id,v_subscription.client_organization_id,p_project_id,'website_crawl',1,0,'active',v_subscription.trial_ends_at
  ) on conflict(project_id,benefit_key) do nothing;

  select * into v_entitlement
  from public.client_trial_entitlements
  where project_id=p_project_id and benefit_key='website_crawl'
  for update;

  select * into v_usage
  from public.client_trial_usage
  where project_id=p_project_id and benefit_key='website_crawl' and idempotency_key=p_idempotency_key;

  if found and v_usage.status<>'failed' then
    return query select 'already_claimed'::text,v_usage.id,(v_entitlement.allowance-v_entitlement.used_count)::smallint;
    return;
  end if;

  if v_entitlement.status in ('expired','converted') or v_entitlement.used_count>=v_entitlement.allowance then
    update public.client_trial_entitlements
    set status=case when expires_at is not null and expires_at<=now() then 'expired' else 'exhausted' end,
        updated_at=now()
    where id=v_entitlement.id;
    return query select 'exhausted'::text,null::uuid,0::smallint;
    return;
  end if;

  update public.client_trial_entitlements
  set used_count=used_count+1,
      status=case when used_count+1>=allowance then 'exhausted' else 'active' end,
      last_used_at=now(),updated_at=now()
  where id=v_entitlement.id
  returning * into v_entitlement;

  if v_usage.id is null then
    insert into public.client_trial_usage(
      entitlement_id,agency_id,client_organization_id,project_id,benefit_key,idempotency_key,status
    ) values(
      v_entitlement.id,v_entitlement.agency_id,v_entitlement.client_organization_id,
      p_project_id,'website_crawl',p_idempotency_key,'claimed'
    ) returning * into v_usage;
  else
    update public.client_trial_usage
    set status='claimed',failure_code=null,background_job_id=null,claimed_at=now(),queued_at=null,completed_at=null,updated_at=now()
    where id=v_usage.id returning * into v_usage;
  end if;

  return query select 'granted'::text,v_usage.id,(v_entitlement.allowance-v_entitlement.used_count)::smallint;
end $$;

create or replace function public.mark_client_trial_crawl_queued(
  p_usage_id uuid,
  p_background_job_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if exists(
    select 1 from public.client_trial_usage
    where id=p_usage_id
      and background_job_id=p_background_job_id
      and status in ('queued','succeeded')
  ) then
    return true;
  end if;
  update public.client_trial_usage
  set status='queued',background_job_id=p_background_job_id,queued_at=now(),updated_at=now()
  where id=p_usage_id and status in ('claimed','queued');
  return found;
end $$;

create or replace function public.release_client_trial_crawl_claim(
  p_usage_id uuid,
  p_failure_code text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_usage public.client_trial_usage%rowtype;
begin
  select * into v_usage from public.client_trial_usage
  where id=p_usage_id for update;
  if not found then return false; end if;
  if v_usage.status<>'claimed' or v_usage.background_job_id is not null then return false; end if;
  update public.client_trial_usage
  set status='failed',failure_code=p_failure_code,completed_at=now(),updated_at=now()
  where id=v_usage.id;
  update public.client_trial_entitlements
  set used_count=greatest(0,used_count-1),
      status=case when expires_at is not null and expires_at<=now() then 'expired' else 'active' end,
      updated_at=now()
  where id=v_usage.entitlement_id;
  return true;
end $$;

create or replace function public.settle_client_trial_crawl(
  p_background_job_id uuid,
  p_status text,
  p_failure_code text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_usage public.client_trial_usage%rowtype;
begin
  if p_status not in ('succeeded','failed') then raise exception 'INVALID_TRIAL_USAGE_STATUS'; end if;
  select * into v_usage from public.client_trial_usage
  where background_job_id=p_background_job_id for update;
  if not found then return false; end if;
  if v_usage.status in ('succeeded','failed') then return true; end if;

  update public.client_trial_usage
  set status=p_status,failure_code=case when p_status='failed' then p_failure_code else null end,
      completed_at=now(),updated_at=now()
  where id=v_usage.id;

  if p_status='failed' then
    update public.client_trial_entitlements
    set used_count=greatest(0,used_count-1),
        status=case when expires_at is not null and expires_at<=now() then 'expired' else 'active' end,
        updated_at=now()
    where id=v_usage.entitlement_id;
  end if;
  return true;
end $$;

revoke all on function public.ensure_client_free_trial_entitlement() from public,anon,authenticated;
revoke all on function public.claim_client_website_crawl(uuid,text) from public,anon,authenticated;
revoke all on function public.mark_client_trial_crawl_queued(uuid,uuid) from public,anon,authenticated;
revoke all on function public.release_client_trial_crawl_claim(uuid,text) from public,anon,authenticated;
revoke all on function public.settle_client_trial_crawl(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_client_website_crawl(uuid,text) to service_role;
grant execute on function public.mark_client_trial_crawl_queued(uuid,uuid) to service_role;
grant execute on function public.release_client_trial_crawl_claim(uuid,text) to service_role;
grant execute on function public.settle_client_trial_crawl(uuid,text,text) to service_role;
