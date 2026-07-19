-- HD SEO Agent-as-a-Service (AaaS).
-- Turns the existing bounded agent control plane into a durable, metered,
-- tenant-scoped managed service for direct customers and white-label agencies.

create table public.agent_service_enrollments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  service_mode text not null default 'managed_agent'
    check(service_mode in ('platform','copilot','managed_agent')),
  operator_brand text not null default 'hdseo'
    check(operator_brand in ('hdseo','agency')),
  approval_owner text not null default 'client'
    check(approval_owner in ('agency','client','both')),
  billing_owner text not null default 'client'
    check(billing_owner in ('agency','client')),
  plan_key text not null default 'growth',
  status text not null default 'trialing'
    check(status in ('trialing','active','paused','past_due','canceled')),
  monthly_action_limit integer not null default 10 check(monthly_action_limit >= 0),
  monthly_provider_budget numeric(12,4) not null default 25 check(monthly_provider_budget >= 0),
  monthly_human_review_minutes integer not null default 0 check(monthly_human_review_minutes >= 0),
  actions_used integer not null default 0 check(actions_used >= 0),
  provider_spend_used numeric(12,4) not null default 0 check(provider_spend_used >= 0),
  human_review_minutes_used integer not null default 0 check(human_review_minutes_used >= 0),
  current_period_start timestamptz not null default date_trunc('month',now()),
  current_period_end timestamptz not null default date_trunc('month',now()) + interval '1 month',
  cycle_cadence_hours integer not null default 24 check(cycle_cadence_hours between 1 and 720),
  next_cycle_at timestamptz not null default now(),
  last_cycle_at timestamptz,
  worker_id text,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  risk_ceiling text not null default 'high' check(risk_ceiling in ('low','medium','high')),
  allowed_tools text[] not null default '{}',
  external_spend_requires_approval boolean not null default true,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_id uuid references public.client_subscriptions(id) on delete set null,
  wholesale_price_cents integer not null default 0 check(wholesale_price_cents >= 0),
  resale_price_cents integer not null default 0 check(resale_price_cents >= 0),
  white_label_settings jsonb not null default '{}',
  pause_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id),
  unique(stripe_subscription_id),
  unique(agency_id,client_organization_id,project_id,id),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.agent_service_cycles (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.agent_service_enrollments(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  cycle_key text not null,
  status text not null default 'queued'
    check(status in ('queued','running','awaiting_approval','monitoring','succeeded','no_action','blocked','failed','canceled')),
  stage text not null default 'evidence',
  evidence_summary jsonb not null default '{}',
  selected_opportunity_id uuid references public.seo_opportunities(id) on delete set null,
  expected_value numeric(14,2),
  work_item_ids uuid[] not null default '{}',
  outcome_summary jsonb not null default '{}',
  recommendation text check(recommendation is null or recommendation in ('KEEP','IMPROVE','ROLLBACK_RECOMMENDED','NO_ACTION')),
  failure_code text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  next_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(enrollment_id,cycle_key)
);

create table public.agent_service_usage (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.agent_service_enrollments(id) on delete cascade,
  cycle_id uuid references public.agent_service_cycles(id) on delete set null,
  work_item_id uuid references public.agent_work_items(id) on delete set null,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  usage_type text not null
    check(usage_type in ('agent_action','provider_cost','human_review','crawl','keyword_check','page_build','deployment','capacity_purchase')),
  quantity numeric(14,4) not null default 1 check(quantity >= 0),
  unit text not null default 'action',
  cost_amount numeric(12,4) not null default 0 check(cost_amount >= 0),
  idempotency_key text not null,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  unique(enrollment_id,idempotency_key)
);

create table public.agent_service_escalations (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.agent_service_enrollments(id) on delete cascade,
  cycle_id uuid references public.agent_service_cycles(id) on delete set null,
  work_item_id uuid references public.agent_work_items(id) on delete set null,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  escalation_type text not null
    check(escalation_type in ('approval','capacity','budget','connection','evidence','risk','worker','billing')),
  title text not null,
  summary text not null,
  risk_level text not null default 'medium' check(risk_level in ('low','medium','high','critical')),
  status text not null default 'open' check(status in ('open','in_progress','waiting','resolved','dismissed')),
  requires_client boolean not null default false,
  metadata jsonb not null default '{}',
  resolved_by uuid references auth.users(id) on delete set null,
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.agency_resale_settings (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  enabled boolean not null default false,
  default_service_mode text not null default 'managed_agent'
    check(default_service_mode in ('platform','copilot','managed_agent')),
  default_approval_owner text not null default 'agency'
    check(default_approval_owner in ('agency','client','both')),
  default_monthly_action_limit integer not null default 10 check(default_monthly_action_limit >= 0),
  default_provider_budget numeric(12,4) not null default 25 check(default_provider_budget >= 0),
  wholesale_price_cents integer not null default 0 check(wholesale_price_cents >= 0),
  suggested_resale_price_cents integer not null default 0 check(suggested_resale_price_cents >= 0),
  brand_name text,
  support_email text,
  disclosure_text text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_service_due_idx on public.agent_service_enrollments(next_cycle_at,status)
  where status in ('trialing','active');
create index agent_service_project_status_idx on public.agent_service_enrollments(project_id,status);
create index agent_service_cycles_project_idx on public.agent_service_cycles(project_id,created_at desc);
create index agent_service_cycles_active_idx on public.agent_service_cycles(enrollment_id,status,created_at desc)
  where status in ('queued','running','awaiting_approval','monitoring');
create index agent_service_usage_period_idx on public.agent_service_usage(enrollment_id,occurred_at desc);
create index agent_service_escalations_open_idx on public.agent_service_escalations(agency_id,status,created_at desc);

alter table public.agent_service_enrollments enable row level security;
alter table public.agent_service_cycles enable row level security;
alter table public.agent_service_usage enable row level security;
alter table public.agent_service_escalations enable row level security;
alter table public.agency_resale_settings enable row level security;

create policy agent_service_enrollments_read on public.agent_service_enrollments for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));
create policy agent_service_enrollments_agency_manage on public.agent_service_enrollments for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy agent_service_cycles_read on public.agent_service_cycles for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));
create policy agent_service_usage_read on public.agent_service_usage for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));
create policy agent_service_escalations_read on public.agent_service_escalations for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));
create policy agent_service_escalations_agency_manage on public.agent_service_escalations for update to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','account_manager']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','account_manager']::public.agency_role[]));
create policy agency_resale_settings_read on public.agency_resale_settings for select to authenticated
  using(public.is_agency_member(agency_id));
create policy agency_resale_settings_manage on public.agency_resale_settings for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin']::public.agency_role[]));

create or replace function public.claim_due_agent_service_enrollments(
  p_worker_id text,
  p_batch_size int default 10,
  p_lock_seconds int default 300
) returns setof public.agent_service_enrollments
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select id
    from public.agent_service_enrollments
    where status in ('trialing','active')
      and service_mode='managed_agent'
      and next_cycle_at <= now()
      and (lock_expires_at is null or lock_expires_at < now())
    order by next_cycle_at,created_at
    for update skip locked
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

create or replace function public.consume_agent_service_capacity(
  p_enrollment_id uuid,
  p_action_units int,
  p_provider_cost numeric,
  p_idempotency_key text,
  p_metadata jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.agent_service_enrollments; v_reset boolean := false;
begin
  select * into e from public.agent_service_enrollments where id=p_enrollment_id for update;
  if e.id is null then raise exception 'AGENT_SERVICE_NOT_FOUND'; end if;
  if exists(select 1 from public.agent_service_usage where enrollment_id=e.id and idempotency_key=p_idempotency_key) then
    return jsonb_build_object('allowed',true,'duplicate',true,'actionsUsed',e.actions_used,'providerSpendUsed',e.provider_spend_used);
  end if;
  if e.current_period_end <= now() then
    update public.agent_service_enrollments set actions_used=0,provider_spend_used=0,human_review_minutes_used=0,
      current_period_start=now(),current_period_end=now()+interval '1 month',updated_at=now() where id=e.id returning * into e;
    v_reset := true;
  end if;
  if e.actions_used+p_action_units > e.monthly_action_limit then
    return jsonb_build_object('allowed',false,'reason','ACTION_CAPACITY_EXCEEDED','actionsUsed',e.actions_used,'actionLimit',e.monthly_action_limit);
  end if;
  if e.provider_spend_used+p_provider_cost > e.monthly_provider_budget then
    return jsonb_build_object('allowed',false,'reason','PROVIDER_BUDGET_EXCEEDED','providerSpendUsed',e.provider_spend_used,'providerBudget',e.monthly_provider_budget);
  end if;
  update public.agent_service_enrollments set actions_used=actions_used+p_action_units,
    provider_spend_used=provider_spend_used+p_provider_cost,updated_at=now() where id=e.id returning * into e;
  insert into public.agent_service_usage(enrollment_id,agency_id,client_organization_id,project_id,usage_type,quantity,unit,cost_amount,idempotency_key,metadata)
  values(e.id,e.agency_id,e.client_organization_id,e.project_id,'agent_action',p_action_units,'action',p_provider_cost,p_idempotency_key,p_metadata);
  return jsonb_build_object('allowed',true,'duplicate',false,'periodReset',v_reset,'actionsUsed',e.actions_used,'actionLimit',e.monthly_action_limit,'providerSpendUsed',e.provider_spend_used,'providerBudget',e.monthly_provider_budget);
end $$;

revoke all on function public.claim_due_agent_service_enrollments(text,int,int) from public,anon,authenticated;
revoke all on function public.consume_agent_service_capacity(uuid,int,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_due_agent_service_enrollments(text,int,int) to service_role;
grant execute on function public.consume_agent_service_capacity(uuid,int,numeric,text,jsonb) to service_role;
