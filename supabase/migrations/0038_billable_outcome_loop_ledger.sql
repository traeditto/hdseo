-- Durable, profit-guarded outcome loop.
--
-- One billable unit is one completed customer-visible SEO outcome. Internal
-- specialist handoffs, retries, previews, QA, monitoring and reporting do not
-- create additional charges. Capacity is reserved before work begins and is
-- committed only after a verified delivery; no-action, rejected, cancelled or
-- failed work releases the reservation exactly once.

create table if not exists public.outcome_loop_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  enrollment_id uuid not null references public.agent_service_enrollments(id) on delete cascade,
  cycle_id uuid not null references public.agent_service_cycles(id) on delete cascade,
  opportunity_id uuid references public.seo_opportunities(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  run_key text not null,
  workflow_version text not null default 'outcome-loop-v1',
  policy_version text not null default 'profit-guard-v1',
  status text not null default 'reserved'
    check(status in ('reserved','analyzing','awaiting_approval','implementing','preview','qa','publishing','monitoring','completed','blocked','failed','cancelled','released','credited')),
  current_step text not null default 'evidence',
  trigger_type text not null default 'scheduled'
    check(trigger_type in ('scheduled','manual','onboarding','recovery')),
  plan_snapshot jsonb not null default '{}',
  evidence_digest text,
  expected_value numeric(14,2),
  observed_value numeric(14,2),
  campaign_job_id uuid references public.seo_campaign_jobs(id) on delete set null,
  implementation_package_id uuid references public.implementation_packages(id) on delete set null,
  execution_id uuid references public.seo_executions(id) on delete set null,
  deployment_id uuid references public.deployments(id) on delete set null,
  monitoring_plan_id uuid references public.seo_monitoring_plans(id) on delete set null,
  delivery_kind text check(delivery_kind is null or delivery_kind in ('repository_release','cms_publication','verified_manual_implementation','approved_deliverable')),
  delivery_proof jsonb not null default '{}',
  delivered_at timestamptz,
  billed_at timestamptz,
  failure_code text,
  failure_message text,
  trace_id uuid not null default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(enrollment_id,run_key),
  unique(agency_id,client_organization_id,project_id,id),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  foreign key(agency_id,client_organization_id,project_id,enrollment_id)
    references public.agent_service_enrollments(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table if not exists public.outcome_loop_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.outcome_loop_runs(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  sequence integer not null check(sequence between 1 and 100),
  step_key text not null,
  step_kind text not null check(step_kind in ('evidence','research','strategy','content','approval','implementation','preview','qa','publish','monitor','report','rollback')),
  required boolean not null default true,
  status text not null default 'pending'
    check(status in ('pending','queued','running','awaiting_approval','waiting','succeeded','skipped','blocked','failed','cancelled')),
  work_item_id uuid references public.agent_work_items(id) on delete set null,
  background_job_id uuid references public.background_jobs(id) on delete set null,
  mutation_intent_id uuid references public.mutation_intents(id) on delete set null,
  deployment_id uuid references public.deployments(id) on delete set null,
  monitoring_plan_id uuid references public.seo_monitoring_plans(id) on delete set null,
  evidence jsonb not null default '{}',
  output jsonb not null default '{}',
  validation jsonb not null default '{}',
  attempt_count integer not null default 0 check(attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id,sequence),
  unique(run_id,step_key),
  foreign key(agency_id,client_organization_id,project_id,run_id)
    references public.outcome_loop_runs(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table if not exists public.billable_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  enrollment_id uuid not null references public.agent_service_enrollments(id) on delete cascade,
  outcome_run_id uuid not null unique references public.outcome_loop_runs(id) on delete cascade,
  unit_key text not null default 'outcome_action' check(unit_key='outcome_action'),
  quantity integer not null default 1 check(quantity=1),
  capacity_source text not null check(capacity_source in ('included','prepaid')),
  included_units integer not null default 0 check(included_units in (0,1)),
  prepaid_units integer not null default 0 check(prepaid_units in (0,1)),
  unit_price_cents integer not null default 0 check(unit_price_cents >= 0),
  customer_amount_cents integer not null default 0 check(customer_amount_cents >= 0),
  status text not null default 'reserved' check(status in ('reserved','committed','released','credited')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  idempotency_key text not null,
  outcome_digest text,
  reserved_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  credited_at timestamptz,
  metadata jsonb not null default '{}',
  unique(enrollment_id,idempotency_key),
  unique(agency_id,client_organization_id,project_id,id),
  check(period_end>period_start),
  check(included_units+prepaid_units=quantity),
  check(
    (capacity_source='included' and included_units=1 and prepaid_units=0 and unit_price_cents=0)
    or (capacity_source='prepaid' and included_units=0 and prepaid_units=1 and unit_price_cents>0)
  ),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  foreign key(agency_id,client_organization_id,project_id,enrollment_id)
    references public.agent_service_enrollments(agency_id,client_organization_id,project_id,id) on delete cascade,
  foreign key(agency_id,client_organization_id,project_id,outcome_run_id)
    references public.outcome_loop_runs(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table if not exists public.billable_usage_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.billable_usage_reservations(id) on delete cascade,
  enrollment_id uuid not null references public.agent_service_enrollments(id) on delete cascade,
  outcome_run_id uuid not null references public.outcome_loop_runs(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  event_type text not null check(event_type in ('reserved','committed','released','credited')),
  quantity integer not null default 1 check(quantity=1),
  customer_amount_cents integer not null default 0 check(customer_amount_cents >= 0),
  event_key text not null unique,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  foreign key(agency_id,client_organization_id,project_id,outcome_run_id)
    references public.outcome_loop_runs(agency_id,client_organization_id,project_id,id) on delete cascade,
  foreign key(agency_id,client_organization_id,project_id,reservation_id)
    references public.billable_usage_reservations(agency_id,client_organization_id,project_id,id) on delete cascade
);

alter table public.agent_service_cycles
  add column if not exists outcome_run_id uuid references public.outcome_loop_runs(id) on delete set null,
  add column if not exists campaign_job_id uuid references public.seo_campaign_jobs(id) on delete set null,
  add column if not exists implementation_package_id uuid references public.implementation_packages(id) on delete set null,
  add column if not exists execution_id uuid references public.seo_executions(id) on delete set null,
  add column if not exists deployment_id uuid references public.deployments(id) on delete set null,
  add column if not exists monitoring_plan_id uuid references public.seo_monitoring_plans(id) on delete set null,
  add column if not exists delivery_kind text,
  add column if not exists delivered_at timestamptz,
  add column if not exists usage_settled_at timestamptz;

alter table public.agent_service_cycles
  drop constraint if exists agent_service_cycles_delivery_kind_check;
alter table public.agent_service_cycles
  add constraint agent_service_cycles_delivery_kind_check
  check(delivery_kind is null or delivery_kind in (
    'repository_release','cms_publication','verified_manual_implementation','approved_deliverable'
  ));

alter table public.seo_campaign_jobs add column if not exists outcome_run_id uuid references public.outcome_loop_runs(id) on delete set null;
alter table public.seo_executions add column if not exists outcome_run_id uuid references public.outcome_loop_runs(id) on delete set null;
alter table public.deployments add column if not exists outcome_run_id uuid references public.outcome_loop_runs(id) on delete set null;
alter table public.seo_monitoring_plans add column if not exists outcome_run_id uuid references public.outcome_loop_runs(id) on delete set null;

create index if not exists outcome_loop_runs_project_idx on public.outcome_loop_runs(project_id,created_at desc);
create index if not exists outcome_loop_runs_active_idx on public.outcome_loop_runs(status,updated_at)
  where status in ('reserved','analyzing','awaiting_approval','implementing','preview','qa','publishing','monitoring');
create index if not exists outcome_loop_steps_run_idx on public.outcome_loop_steps(run_id,sequence);
create index if not exists billable_reservation_status_idx on public.billable_usage_reservations(enrollment_id,status,reserved_at desc);
create index if not exists billable_usage_events_period_idx on public.billable_usage_events(enrollment_id,occurred_at desc);

alter table public.outcome_loop_runs enable row level security;
alter table public.outcome_loop_steps enable row level security;
alter table public.billable_usage_reservations enable row level security;
alter table public.billable_usage_events enable row level security;

drop policy if exists outcome_loop_runs_read on public.outcome_loop_runs;
drop policy if exists outcome_loop_steps_read on public.outcome_loop_steps;
drop policy if exists billable_usage_reservations_read on public.billable_usage_reservations;
drop policy if exists billable_usage_events_read on public.billable_usage_events;

create policy outcome_loop_runs_read on public.outcome_loop_runs for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));
create policy outcome_loop_steps_read on public.outcome_loop_steps for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));
create policy billable_usage_reservations_read on public.billable_usage_reservations for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));
create policy billable_usage_events_read on public.billable_usage_events for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));

revoke all on public.outcome_loop_runs,public.outcome_loop_steps,
  public.billable_usage_reservations,public.billable_usage_events from anon;
revoke all on public.outcome_loop_runs,public.outcome_loop_steps,
  public.billable_usage_reservations,public.billable_usage_events from authenticated;
grant select on public.outcome_loop_runs,public.outcome_loop_steps,
  public.billable_usage_reservations,public.billable_usage_events to authenticated;
grant select,insert,update,delete on public.outcome_loop_runs,public.outcome_loop_steps,
  public.billable_usage_reservations to service_role;
grant select,insert on public.billable_usage_events to service_role;

-- User-facing writes must go through tenant-checked server APIs. In particular,
-- authenticated users cannot edit plan keys, counters, Stripe IDs or balances.
drop policy if exists agent_service_enrollments_agency_manage on public.agent_service_enrollments;
revoke insert,update,delete on public.agent_service_enrollments from anon,authenticated;
revoke insert,update,delete on public.agent_service_cycles from anon,authenticated;
revoke insert,update,delete on public.agent_service_usage from anon,authenticated;
revoke insert,update,delete on public.outcome_loop_runs from anon,authenticated;
revoke insert,update,delete on public.outcome_loop_steps from anon,authenticated;
revoke insert,update,delete on public.billable_usage_reservations from anon,authenticated;
revoke insert,update,delete on public.billable_usage_events from anon,authenticated;
revoke insert,update,delete on public.agency_subscriptions from anon,authenticated;
revoke insert,update,delete on public.client_subscriptions from anon,authenticated;

create or replace function public.start_outcome_loop_run(
  p_enrollment_id uuid,
  p_cycle_id uuid,
  p_opportunity_id uuid,
  p_requested_by uuid,
  p_run_key text,
  p_trigger_type text default 'scheduled',
  p_expected_value numeric default null,
  p_plan_snapshot jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.agent_service_enrollments;
  c public.agent_service_cycles;
  r public.outcome_loop_runs;
  b public.billable_usage_reservations;
  v_source text;
  v_included integer := 0;
  v_prepaid integer := 0;
  v_duplicate boolean := false;
begin
  if coalesce(trim(p_run_key),'')='' or p_trigger_type not in ('scheduled','manual','onboarding','recovery') then
    raise exception 'INVALID_OUTCOME_RUN';
  end if;
  if p_expected_value is not null and p_expected_value < 0 then raise exception 'INVALID_EXPECTED_VALUE'; end if;
  if jsonb_typeof(coalesce(p_plan_snapshot,'{}')) <> 'object' then raise exception 'INVALID_PLAN_SNAPSHOT'; end if;
  select * into e from public.agent_service_enrollments where id=p_enrollment_id for update;
  if e.id is null then raise exception 'AGENT_SERVICE_NOT_FOUND'; end if;
  if not exists(
    select 1 from public.clients
    where id=e.client_id and agency_id=e.agency_id
      and organization_id=e.client_organization_id
  ) then raise exception 'AGENT_SERVICE_SCOPE_MISMATCH'; end if;
  if e.status not in ('trialing','active') then
    return jsonb_build_object('allowed',false,'reason','SUBSCRIPTION_INACTIVE');
  end if;
  select * into c from public.agent_service_cycles
    where id=p_cycle_id and enrollment_id=e.id and agency_id=e.agency_id
      and client_organization_id=e.client_organization_id and client_id=e.client_id
      and project_id=e.project_id;
  if c.id is null then raise exception 'OUTCOME_CYCLE_SCOPE_MISMATCH'; end if;
  if p_opportunity_id is not null and not exists(
    select 1 from public.seo_opportunities
    where id=p_opportunity_id and agency_id=e.agency_id
      and client_organization_id=e.client_organization_id and project_id=e.project_id
  ) then raise exception 'OUTCOME_OPPORTUNITY_SCOPE_MISMATCH'; end if;
  if p_requested_by is not null and not (
    exists(select 1 from public.agency_members
      where agency_id=e.agency_id and user_id=p_requested_by and status='active')
    or exists(select 1 from public.client_members
      where agency_id=e.agency_id and client_organization_id=e.client_organization_id
        and user_id=p_requested_by and status='active'
        and role in ('client_admin','client_approver'))
  ) then raise exception 'REQUESTER_NOT_AUTHORIZED'; end if;

  select * into r from public.outcome_loop_runs
    where enrollment_id=e.id and run_key=p_run_key;
  if r.id is not null then
    -- An idempotency key identifies one exact cycle/opportunity. Validate the
    -- immutable scope before returning an existing reservation so a caller
    -- cannot accidentally (or maliciously) reuse capacity across different
    -- work under the same run key.
    if r.cycle_id<>c.id or r.opportunity_id is distinct from p_opportunity_id then
      raise exception 'OUTCOME_RUN_KEY_CONFLICT';
    end if;
    select * into b from public.billable_usage_reservations where outcome_run_id=r.id;
    if b.id is not null then
      if b.status='reserved' then
        return jsonb_build_object('allowed',true,'duplicate',true,'runId',r.id,
          'reservationId',b.id,'status',r.status,'reason',null);
      end if;
      return jsonb_build_object('allowed',false,'duplicate',true,'runId',r.id,
        'reservationId',b.id,'status',r.status,'reason','OUTCOME_RUN_ALREADY_FINAL');
    end if;
    if r.status<>'blocked' or r.failure_code<>'CHECKOUT_REQUIRED' then
      return jsonb_build_object('allowed',false,'duplicate',true,'runId',r.id,
        'status',r.status,'reason','OUTCOME_RUN_NOT_RESERVABLE');
    end if;
    -- A capacity-blocked run may resume under the same idempotency key after a
    -- successful prepaid-capacity checkout.
    v_duplicate := true;
  end if;

  if e.current_period_end <= now() then
    update public.agent_service_enrollments set actions_used=0,provider_spend_used=0,human_review_minutes_used=0,
      current_period_start=now(),current_period_end=now()+interval '1 month',updated_at=now()
      where id=e.id returning * into e;
  end if;

  if r.id is null then
    insert into public.outcome_loop_runs(
      agency_id,client_organization_id,client_id,project_id,enrollment_id,cycle_id,
      opportunity_id,requested_by,run_key,trigger_type,status,current_step,
      plan_snapshot,expected_value
    ) values(
      e.agency_id,e.client_organization_id,e.client_id,e.project_id,e.id,c.id,
      p_opportunity_id,p_requested_by,p_run_key,p_trigger_type,'reserved','evidence',
      coalesce(p_plan_snapshot,'{}'),p_expected_value
    ) returning * into r;
  end if;

  if e.actions_used < e.monthly_action_limit then
    v_source := 'included'; v_included := 1;
  elsif e.purchased_action_balance > 0 then
    v_source := 'prepaid'; v_prepaid := 1;
  else
    update public.outcome_loop_runs set status='blocked',current_step='capacity',
      failure_code='CHECKOUT_REQUIRED',failure_message='Included outcome capacity is exhausted.',updated_at=now()
      where id=r.id;
    update public.agent_service_cycles set outcome_run_id=r.id,status='blocked',stage='capacity',
      failure_code='CHECKOUT_REQUIRED',failure_message='Included outcome capacity is exhausted.',completed_at=now(),updated_at=now()
      where id=c.id;
    return jsonb_build_object('allowed',false,'duplicate',v_duplicate,'runId',r.id,'reason','CHECKOUT_REQUIRED',
      'actionsUsed',e.actions_used,'actionLimit',e.monthly_action_limit,'purchasedActionBalance',e.purchased_action_balance);
  end if;

  update public.agent_service_enrollments set
    actions_used=actions_used+1,
    purchased_action_balance=purchased_action_balance-v_prepaid,
    updated_at=now()
  where id=e.id returning * into e;

  insert into public.billable_usage_reservations(
    agency_id,client_organization_id,project_id,enrollment_id,outcome_run_id,
    capacity_source,included_units,prepaid_units,unit_price_cents,customer_amount_cents,
    period_start,period_end,idempotency_key,metadata
  ) values(
    e.agency_id,e.client_organization_id,e.project_id,e.id,r.id,
    v_source,v_included,v_prepaid,case when v_prepaid=1 then 1500 else 0 end,0,
    e.current_period_start,e.current_period_end,'outcome:'||r.id,
    jsonb_build_object('cycleId',c.id,'opportunityId',p_opportunity_id,'definition','one completed customer-visible SEO outcome')
  ) returning * into b;

  insert into public.billable_usage_events(
    reservation_id,enrollment_id,outcome_run_id,agency_id,client_organization_id,project_id,
    event_type,event_key,metadata
  ) values(
    b.id,e.id,r.id,e.agency_id,e.client_organization_id,e.project_id,
    'reserved','outcome:'||r.id||':reserved',jsonb_build_object('capacitySource',v_source)
  );

  insert into public.outcome_loop_steps(run_id,agency_id,client_organization_id,project_id,sequence,step_key,step_kind)
  select r.id,e.agency_id,e.client_organization_id,e.project_id,s.sequence,s.step_key,s.step_kind
  from (values
    (1,'evidence','evidence'),(2,'research','research'),(3,'strategy','strategy'),
    (4,'content','content'),(5,'approval','approval'),(6,'implementation','implementation'),
    (7,'preview','preview'),(8,'qa','qa'),(9,'publish','publish'),
    (10,'monitor','monitor'),(11,'report','report')
  ) as s(sequence,step_key,step_kind)
  on conflict(run_id,step_key) do nothing;

  update public.outcome_loop_runs set status='analyzing',current_step='evidence',
    failure_code=null,failure_message=null,completed_at=null,updated_at=now() where id=r.id;
  update public.agent_service_cycles set outcome_run_id=r.id,status='running',stage='evidence',
    failure_code=null,failure_message=null,completed_at=null,updated_at=now() where id=c.id;
  return jsonb_build_object('allowed',true,'duplicate',v_duplicate,'runId',r.id,'reservationId',b.id,
    'capacitySource',v_source,'actionsUsed',e.actions_used,'actionLimit',e.monthly_action_limit,
    'purchasedActionBalance',e.purchased_action_balance);
end $$;

create or replace function public.commit_outcome_loop_run(
  p_run_id uuid,
  p_delivery_kind text,
  p_delivery_proof jsonb,
  p_outcome_digest text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.outcome_loop_runs; b public.billable_usage_reservations;
begin
  if p_delivery_kind not in ('repository_release','cms_publication','verified_manual_implementation','approved_deliverable')
    or coalesce(trim(p_outcome_digest),'')='' or jsonb_typeof(coalesce(p_delivery_proof,'{}'))<>'object'
    or coalesce(p_delivery_proof,'{}')='{}'::jsonb then raise exception 'INVALID_DELIVERY_PROOF'; end if;
  select * into r from public.outcome_loop_runs where id=p_run_id for update;
  if r.id is null then raise exception 'OUTCOME_RUN_NOT_FOUND'; end if;
  select * into b from public.billable_usage_reservations where outcome_run_id=r.id for update;
  if b.id is null then raise exception 'OUTCOME_RESERVATION_NOT_FOUND'; end if;
  if b.status='committed' then return false; end if;
  if b.status<>'reserved' then raise exception 'OUTCOME_RESERVATION_NOT_COMMITTABLE'; end if;

  update public.billable_usage_reservations set status='committed',outcome_digest=p_outcome_digest,
    committed_at=now(),metadata=metadata||jsonb_build_object('deliveryKind',p_delivery_kind) where id=b.id;
  insert into public.billable_usage_events(
    reservation_id,enrollment_id,outcome_run_id,agency_id,client_organization_id,project_id,
    event_type,event_key,metadata
  ) values(
    b.id,b.enrollment_id,r.id,r.agency_id,r.client_organization_id,r.project_id,
    'committed','outcome:'||r.id||':committed',jsonb_build_object('deliveryKind',p_delivery_kind,'outcomeDigest',p_outcome_digest)
  ) on conflict(event_key) do nothing;
  insert into public.agent_service_usage(
    enrollment_id,cycle_id,agency_id,client_organization_id,project_id,usage_type,
    quantity,unit,cost_amount,idempotency_key,metadata
  ) values(
    b.enrollment_id,r.cycle_id,r.agency_id,r.client_organization_id,r.project_id,'agent_action',
    1,'completed_outcome',0,'outcome:'||r.id||':committed',
    jsonb_build_object('outcomeRunId',r.id,'capacitySource',b.capacity_source,'deliveryKind',p_delivery_kind,'outcomeDigest',p_outcome_digest,'creditStatus','earned')
  ) on conflict(enrollment_id,idempotency_key) do nothing;
  update public.outcome_loop_runs set status='completed',current_step='report',delivery_kind=p_delivery_kind,
    delivery_proof=coalesce(p_delivery_proof,'{}'),delivered_at=coalesce(delivered_at,now()),billed_at=now(),
    completed_at=now(),updated_at=now() where id=r.id;
  update public.agent_service_cycles set status='succeeded',stage='outcome',delivery_kind=p_delivery_kind,
    delivered_at=now(),usage_settled_at=now(),completed_at=now(),recommendation=null,updated_at=now()
    where id=r.cycle_id;
  return true;
end $$;

create or replace function public.release_outcome_loop_run(
  p_run_id uuid,
  p_reason text,
  p_final_status text default 'released'
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.outcome_loop_runs; b public.billable_usage_reservations; e public.agent_service_enrollments;
begin
  if p_final_status not in ('released','failed','cancelled','blocked') then raise exception 'INVALID_FINAL_STATUS'; end if;
  select * into r from public.outcome_loop_runs where id=p_run_id for update;
  if r.id is null then raise exception 'OUTCOME_RUN_NOT_FOUND'; end if;
  select * into b from public.billable_usage_reservations where outcome_run_id=r.id for update;
  if b.id is null or b.status in ('released','credited') then return false; end if;
  if b.status='committed' then raise exception 'COMMITTED_OUTCOME_REQUIRES_CREDIT'; end if;
  select * into e from public.agent_service_enrollments where id=b.enrollment_id for update;
  update public.agent_service_enrollments set
    actions_used=case when current_period_start=b.period_start then greatest(0,actions_used-1) else actions_used end,
    purchased_action_balance=purchased_action_balance+b.prepaid_units,
    updated_at=now()
  where id=e.id;
  update public.billable_usage_reservations set status='released',released_at=now(),
    metadata=metadata||jsonb_build_object('releaseReason',left(coalesce(p_reason,'Not delivered'),500)) where id=b.id;
  insert into public.billable_usage_events(
    reservation_id,enrollment_id,outcome_run_id,agency_id,client_organization_id,project_id,
    event_type,event_key,metadata
  ) values(
    b.id,b.enrollment_id,r.id,r.agency_id,r.client_organization_id,r.project_id,
    'released','outcome:'||r.id||':released',jsonb_build_object('reason',left(coalesce(p_reason,'Not delivered'),500))
  ) on conflict(event_key) do nothing;
  update public.outcome_loop_runs set status=p_final_status,current_step='complete',failure_code=upper(p_final_status),
    failure_message=left(coalesce(p_reason,'Not delivered'),500),completed_at=now(),updated_at=now() where id=r.id;
  update public.agent_service_cycles set status=case
      when p_final_status in ('cancelled','released') then 'canceled'
      else p_final_status
    end,
    stage='outcome',failure_code=upper(p_final_status),failure_message=left(coalesce(p_reason,'Not delivered'),500),
    usage_settled_at=now(),completed_at=now(),updated_at=now()
    where id=r.cycle_id;
  return true;
end $$;

-- Record actual provider cost even when it exceeds the estimate. Any overrun
-- pauses managed work and raises an escalation instead of being silently
-- clipped, which keeps margin leakage visible and fail-closed.
create or replace function public.settle_agent_service_provider_cost(
  p_usage_id uuid,
  p_actual_cost numeric,
  p_status text,
  p_metadata jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u public.agent_service_usage;
  e public.agent_service_enrollments;
  v_actual numeric;
  v_refund numeric;
  v_overrun numeric;
  v_purchased_reserved numeric;
begin
  if p_status not in ('completed','failed') or p_actual_cost is null or p_actual_cost<0 then
    raise exception 'INVALID_PROVIDER_SETTLEMENT';
  end if;
  select * into u from public.agent_service_usage where id=p_usage_id for update;
  if u.id is null or coalesce(u.metadata->>'reservationStatus','') <> 'reserved' then return; end if;
  select * into e from public.agent_service_enrollments where id=u.enrollment_id for update;
  v_actual := case when p_status='completed' then greatest(0,p_actual_cost) else 0 end;
  v_refund := greatest(0,u.cost_amount-v_actual);
  v_overrun := greatest(0,v_actual-u.cost_amount);
  v_purchased_reserved := coalesce((u.metadata->>'purchasedReserved')::numeric,0);
  update public.agent_service_enrollments set
    provider_spend_used=greatest(0,provider_spend_used-v_refund+v_overrun),
    purchased_provider_balance=purchased_provider_balance+least(v_refund,v_purchased_reserved),
    status=case when v_overrun>0 then 'paused' else status end,
    pause_reason=case when v_overrun>0 then 'Provider actual cost exceeded its approved reservation' else pause_reason end,
    updated_at=now()
  where id=e.id;
  update public.agent_service_usage set cost_amount=v_actual,
    metadata=metadata||coalesce(p_metadata,'{}')||jsonb_build_object(
      'reservationStatus',p_status,'reservedCost',u.cost_amount,'actualCost',v_actual,'costOverrun',v_overrun)
    where id=u.id;
  if v_overrun>0 then
    insert into public.agent_service_escalations(
      enrollment_id,agency_id,client_organization_id,project_id,escalation_type,
      title,summary,risk_level,requires_client,metadata
    ) values(
      e.id,e.agency_id,e.client_organization_id,e.project_id,'budget',
      'Provider cost guard paused managed work',
      'A provider reported a cost above the amount reserved before execution. Managed work is paused for review.',
      'high',false,jsonb_build_object('usageId',u.id,'reservedCost',u.cost_amount,'actualCost',v_actual,'overrun',v_overrun)
    );
  end if;
end $$;

revoke all on function public.start_outcome_loop_run(uuid,uuid,uuid,uuid,text,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.commit_outcome_loop_run(uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.release_outcome_loop_run(uuid,text,text) from public,anon,authenticated;
revoke all on function public.settle_agent_service_provider_cost(uuid,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.start_outcome_loop_run(uuid,uuid,uuid,uuid,text,text,numeric,jsonb) to service_role;
grant execute on function public.commit_outcome_loop_run(uuid,text,jsonb,text) to service_role;
grant execute on function public.release_outcome_loop_run(uuid,text,text) to service_role;
grant execute on function public.settle_agent_service_provider_cost(uuid,numeric,text,jsonb) to service_role;
