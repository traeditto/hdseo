-- Founding Beta v1.1: hold a 25% pre-tax contribution margin while giving
-- early customers a larger, bounded evidence/provider allowance.
--
-- The public price is not a blank spending account. Every included variable
-- provider cost is reserved atomically against both the plan allowance and
-- the beta all-in delivery ceiling. Customer-funded capacity add-ons remain
-- separate because they carry their own revenue and margin guard.

alter table public.agent_service_enrollments
  add column if not exists minimum_contribution_margin_pct numeric(5,2)
    check(minimum_contribution_margin_pct is null or minimum_contribution_margin_pct between 0 and 100),
  add column if not exists all_in_delivery_cost_ceiling numeric(12,4)
    check(all_in_delivery_cost_ceiling is null or all_in_delivery_cost_ceiling >= 0),
  add column if not exists all_in_delivery_cost_used numeric(12,4) not null default 0
    check(all_in_delivery_cost_used >= 0),
  add column if not exists economics_policy jsonb not null default '{}';

create table if not exists public.beta_delivery_cost_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.agent_service_enrollments(id) on delete cascade,
  usage_id uuid not null references public.agent_service_usage(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  category text not null check(category in ('provider','model','data','infrastructure','human_review','implementation','qa','payment_processing','contingency')),
  status text not null default 'reserved' check(status in ('reserved','completed','failed','released')),
  included_reserved_cost numeric(12,6) not null default 0 check(included_reserved_cost >= 0),
  actual_cost numeric(12,6) check(actual_cost is null or actual_cost >= 0),
  idempotency_key text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique(enrollment_id,idempotency_key),
  unique(usage_id)
);

create index if not exists beta_delivery_cost_project_idx
  on public.beta_delivery_cost_events(project_id,created_at desc);
alter table public.beta_delivery_cost_events enable row level security;
drop policy if exists beta_delivery_cost_agency_read on public.beta_delivery_cost_events;
create policy beta_delivery_cost_agency_read on public.beta_delivery_cost_events
  for select to authenticated using(public.is_agency_member(agency_id));
revoke insert,update,delete on public.beta_delivery_cost_events from anon,authenticated;

-- Reconcile all still-reserved or active beta offers to the 25% ceiling.
update public.beta_offer_enrollments set max_all_in_cost_cents=case
  when audience='business' and plan_key='starter' then 7425
  when audience='business' and plan_key='growth' then 18675
  when audience='business' and plan_key='pro' then 44925
  when audience='business' and plan_key='autopilot_plus' then 59925
  when audience='agency' and plan_key='launch' then 22425
  when audience='agency' and plan_key='growth' then 44925
  when audience='agency' and plan_key='scale' then 97425
  else max_all_in_cost_cents end,
  updated_at=now()
where offer_key='founding_beta_2026' and status in ('reserved','active');

-- Existing paid business beta customers receive the larger beta provider
-- allowance immediately, while a modeled fixed-delivery reserve keeps
-- payment processing, implementation, QA, support, and founder time visible.
update public.agent_service_enrollments e set
  minimum_contribution_margin_pct=25,
  all_in_delivery_cost_ceiling=b.max_all_in_cost_cents::numeric/100,
  all_in_delivery_cost_used=greatest(
    e.provider_spend_used,
    case e.plan_key
      when 'starter' then 25
      when 'growth' then 100
      when 'pro' then 318
      when 'autopilot_plus' then 434
      else 0 end
  ),
  monthly_provider_budget=greatest(
    e.monthly_provider_budget,
    case e.plan_key
      when 'starter' then 8
      when 'growth' then 25
      when 'pro' then 60
      when 'autopilot_plus' then 90
      else e.monthly_provider_budget end
  ),
  economics_policy=jsonb_build_object(
    'version','founding_beta_25_v1',
    'offerKey',b.offer_key,
    'offerEndsAt',b.ends_at,
    'measurementEndsAt',b.activated_at+interval '90 days',
    'fixedDeliveryReserveDollars',case e.plan_key
      when 'starter' then 25 when 'growth' then 100 when 'pro' then 318 when 'autopilot_plus' then 434 else 0 end,
    'includedProviderBudgetDollars',case e.plan_key
      when 'starter' then 8 when 'growth' then 25 when 'pro' then 60 when 'autopilot_plus' then 90 else 0 end,
    'targetContributionMarginPercent',25
  ),
  updated_at=now()
from public.beta_offer_enrollments b
where b.audience='business' and b.status='active' and b.project_id=e.project_id
  and b.offer_key='founding_beta_2026' and coalesce(b.ends_at,now()+interval '1 day')>now();

create or replace function public.reserve_agent_service_provider_cost(
  p_enrollment_id uuid,
  p_estimated_cost numeric,
  p_idempotency_key text,
  p_metadata jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.agent_service_enrollments;
  u public.agent_service_usage;
  v_base_remaining numeric;
  v_purchased numeric;
  v_included_reserved numeric;
  v_fixed_reserve numeric;
  v_offer_ends_at timestamptz;
begin
  if p_estimated_cost is null or p_estimated_cost<0 or coalesce(trim(p_idempotency_key),'')='' then
    raise exception 'INVALID_PROVIDER_RESERVATION';
  end if;
  select * into e from public.agent_service_enrollments where id=p_enrollment_id for update;
  if e.id is null then raise exception 'AGENT_SERVICE_NOT_FOUND'; end if;
  select * into u from public.agent_service_usage where enrollment_id=e.id and idempotency_key=p_idempotency_key;
  if u.id is not null then return jsonb_build_object('allowed',true,'duplicate',true,'usageId',u.id); end if;

  if coalesce(e.economics_policy->>'offerEndsAt','')<>'' then
    begin v_offer_ends_at := (e.economics_policy->>'offerEndsAt')::timestamptz;
    exception when others then v_offer_ends_at := null; end;
  end if;
  if v_offer_ends_at is not null and v_offer_ends_at<=now() then
    update public.agent_service_enrollments set minimum_contribution_margin_pct=null,
      all_in_delivery_cost_ceiling=null,all_in_delivery_cost_used=0,economics_policy='{}',updated_at=now()
      where id=e.id returning * into e;
  end if;

  if e.current_period_end <= now() then
    v_fixed_reserve := greatest(0,coalesce((e.economics_policy->>'fixedDeliveryReserveDollars')::numeric,0));
    update public.agent_service_enrollments set actions_used=0,provider_spend_used=0,human_review_minutes_used=0,
      all_in_delivery_cost_used=case when all_in_delivery_cost_ceiling is null then 0 else v_fixed_reserve end,
      current_period_start=now(),current_period_end=now()+interval '1 month',updated_at=now()
      where id=e.id returning * into e;
  end if;

  v_base_remaining := greatest(0,e.monthly_provider_budget-e.provider_spend_used);
  v_purchased := greatest(0,p_estimated_cost-v_base_remaining);
  if v_purchased > e.purchased_provider_balance then
    return jsonb_build_object('allowed',false,'reason','PROVIDER_BUDGET_EXCEEDED','providerSpendUsed',e.provider_spend_used,
      'providerBudget',e.monthly_provider_budget,'purchasedProviderBalance',e.purchased_provider_balance);
  end if;
  v_included_reserved := greatest(0,p_estimated_cost-v_purchased);
  if e.all_in_delivery_cost_ceiling is not null and
     e.all_in_delivery_cost_used+v_included_reserved>e.all_in_delivery_cost_ceiling then
    return jsonb_build_object(
      'allowed',false,'reason','BETA_DELIVERY_COST_CEILING_REACHED',
      'deliveryCostUsed',e.all_in_delivery_cost_used,
      'deliveryCostCeiling',e.all_in_delivery_cost_ceiling,
      'minimumContributionMarginPercent',e.minimum_contribution_margin_pct
    );
  end if;

  update public.agent_service_enrollments set
    provider_spend_used=provider_spend_used+p_estimated_cost,
    purchased_provider_balance=purchased_provider_balance-v_purchased,
    all_in_delivery_cost_used=all_in_delivery_cost_used+v_included_reserved,
    updated_at=now() where id=e.id;
  insert into public.agent_service_usage(
    enrollment_id,agency_id,client_organization_id,project_id,usage_type,quantity,unit,cost_amount,idempotency_key,metadata
  ) values(
    e.id,e.agency_id,e.client_organization_id,e.project_id,'provider_cost',1,'request',p_estimated_cost,p_idempotency_key,
    coalesce(p_metadata,'{}')||jsonb_build_object(
      'purchasedReserved',v_purchased,'betaIncludedReserved',v_included_reserved,'reservationStatus','reserved'
    )
  ) returning * into u;
  if e.all_in_delivery_cost_ceiling is not null then
    insert into public.beta_delivery_cost_events(
      enrollment_id,usage_id,agency_id,client_organization_id,project_id,category,status,
      included_reserved_cost,idempotency_key,metadata
    ) values(
      e.id,u.id,e.agency_id,e.client_organization_id,e.project_id,
      case when coalesce(p_metadata->>'provider','')='openai' then 'model' else 'provider' end,
      'reserved',v_included_reserved,p_idempotency_key,
      jsonb_build_object('provider',p_metadata->>'provider','operation',p_metadata->>'operation')
    );
  end if;
  return jsonb_build_object('allowed',true,'duplicate',false,'usageId',u.id,
    'reservedCost',p_estimated_cost,'includedReservedCost',v_included_reserved);
end $$;

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
  v_included_reserved numeric;
  v_included_actual numeric;
  v_included_delta numeric;
  v_margin_overrun boolean;
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
  v_included_reserved := coalesce((u.metadata->>'betaIncludedReserved')::numeric,0);
  v_included_actual := case when p_status='completed'
    then least(v_actual,v_included_reserved)+v_overrun else 0 end;
  v_included_delta := v_included_actual-v_included_reserved;
  v_margin_overrun := e.all_in_delivery_cost_ceiling is not null and
    e.all_in_delivery_cost_used+v_included_delta>e.all_in_delivery_cost_ceiling;

  update public.agent_service_enrollments set
    provider_spend_used=greatest(0,provider_spend_used-v_refund+v_overrun),
    purchased_provider_balance=purchased_provider_balance+least(v_refund,v_purchased_reserved),
    all_in_delivery_cost_used=greatest(0,all_in_delivery_cost_used+v_included_delta),
    status=case when v_overrun>0 or v_margin_overrun then 'paused' else status end,
    pause_reason=case
      when v_margin_overrun then 'Founding Beta delivery cost reached its protected contribution-margin ceiling'
      when v_overrun>0 then 'Provider actual cost exceeded its approved reservation'
      else pause_reason end,
    updated_at=now()
  where id=e.id;
  update public.agent_service_usage set cost_amount=v_actual,
    metadata=metadata||coalesce(p_metadata,'{}')||jsonb_build_object(
      'reservationStatus',p_status,'reservedCost',u.cost_amount,'actualCost',v_actual,'costOverrun',v_overrun)
    where id=u.id;
  update public.beta_delivery_cost_events set status=p_status,actual_cost=v_included_actual,
    metadata=metadata||coalesce(p_metadata,'{}'),settled_at=now() where usage_id=u.id and status='reserved';

  if v_overrun>0 or v_margin_overrun then
    insert into public.agent_service_escalations(
      enrollment_id,agency_id,client_organization_id,project_id,escalation_type,
      title,summary,risk_level,requires_client,metadata
    ) values(
      e.id,e.agency_id,e.client_organization_id,e.project_id,'budget',
      case when v_margin_overrun then 'Protected contribution-margin ceiling reached'
        else 'Provider cost guard paused managed work' end,
      case when v_margin_overrun
        then 'Included beta delivery costs reached the approved ceiling. Managed work is paused; no unapproved charge was sent to the customer.'
        else 'A provider reported a cost above the amount reserved before execution. Managed work is paused for review.' end,
      'high',false,jsonb_build_object(
        'usageId',u.id,'reservedCost',u.cost_amount,'actualCost',v_actual,'overrun',v_overrun,
        'deliveryCostUsed',e.all_in_delivery_cost_used+v_included_delta,
        'deliveryCostCeiling',e.all_in_delivery_cost_ceiling
      )
    );
  end if;
end $$;

revoke all on function public.reserve_agent_service_provider_cost(uuid,numeric,text,jsonb) from public,anon,authenticated;
revoke all on function public.settle_agent_service_provider_cost(uuid,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_agent_service_provider_cost(uuid,numeric,text,jsonb) to service_role;
grant execute on function public.settle_agent_service_provider_cost(uuid,numeric,text,jsonb) to service_role;
