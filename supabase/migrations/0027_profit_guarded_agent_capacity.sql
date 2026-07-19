-- Profit-safe agent-service capacity and model/provider usage accounting.
-- Purchased action credits roll forward until consumed. Internal agent handoffs
-- never consume additional credits, and failed cycles can refund their credit.

alter table public.agent_service_enrollments
  add column if not exists purchased_action_balance integer not null default 0
    check(purchased_action_balance >= 0),
  add column if not exists purchased_provider_balance numeric(12,4) not null default 0
    check(purchased_provider_balance >= 0);

create table if not exists public.model_usage_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  provider text not null default 'openai',
  operation_type text not null,
  model text not null,
  status text not null default 'reserved'
    check(status in ('reserved','completed','failed')),
  input_tokens integer not null default 0 check(input_tokens >= 0),
  cached_input_tokens integer not null default 0 check(cached_input_tokens >= 0),
  output_tokens integer not null default 0 check(output_tokens >= 0),
  estimated_cost numeric(12,6) not null default 0 check(estimated_cost >= 0),
  actual_cost numeric(12,6) check(actual_cost is null or actual_cost >= 0),
  idempotency_key text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique(project_id,idempotency_key),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create index if not exists model_usage_project_period_idx
  on public.model_usage_events(project_id,created_at desc);
create index if not exists model_usage_platform_period_idx
  on public.model_usage_events(provider,created_at desc);

alter table public.model_usage_events enable row level security;
drop policy if exists model_usage_events_read on public.model_usage_events;
create policy model_usage_events_read on public.model_usage_events for select to authenticated
  using(public.is_agency_member(agency_id) or public.has_client_access(agency_id,client_organization_id));

alter table public.agent_service_usage
  drop constraint if exists agent_service_usage_usage_type_check;
alter table public.agent_service_usage
  add constraint agent_service_usage_usage_type_check
  check(usage_type in ('agent_action','provider_cost','human_review','crawl','keyword_check','page_build','deployment','capacity_purchase','capacity_refund'));

-- Apply conservative hard provider ceilings to existing standard plans. These
-- are maximum direct API/data costs, not customer-facing SEO budgets.
update public.agent_service_enrollments
set monthly_provider_budget = least(monthly_provider_budget,
  case plan_key
    when 'starter' then 5
    when 'growth' then 10
    when 'pro' then 18
    when 'agency_core' then 10
    when 'agency_scale' then 18
    else monthly_provider_budget
  end), updated_at=now();

create or replace function public.reserve_model_usage(
  p_agency_id uuid,
  p_client_organization_id uuid,
  p_project_id uuid,
  p_operation_type text,
  p_model text,
  p_estimated_cost numeric,
  p_project_daily_limit numeric,
  p_platform_daily_limit numeric,
  p_idempotency_key text,
  p_metadata jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event public.model_usage_events; v_project numeric; v_platform numeric;
begin
  if p_estimated_cost < 0 then raise exception 'INVALID_ESTIMATED_COST'; end if;
  -- The platform lock makes the global daily ceiling atomic even when many
  -- tenants reserve spend concurrently. Always acquire it before project lock.
  perform pg_advisory_xact_lock(hashtext('openai-platform-daily-cost'));
  perform pg_advisory_xact_lock(hashtext(p_project_id::text));
  select * into v_event from public.model_usage_events
    where project_id=p_project_id and idempotency_key=p_idempotency_key;
  if v_event.id is not null then
    return jsonb_build_object('allowed',true,'duplicate',true,'usageId',v_event.id);
  end if;
  select coalesce(sum(coalesce(actual_cost,estimated_cost)),0) into v_project
    from public.model_usage_events where project_id=p_project_id
      and status in ('reserved','completed') and created_at >= now()-interval '24 hours';
  select coalesce(sum(coalesce(actual_cost,estimated_cost)),0) into v_platform
    from public.model_usage_events where provider='openai'
      and status in ('reserved','completed') and created_at >= now()-interval '24 hours';
  if v_project+p_estimated_cost > p_project_daily_limit then
    return jsonb_build_object('allowed',false,'reason','PROJECT_DAILY_MODEL_BUDGET_EXCEEDED','spent',v_project,'limit',p_project_daily_limit);
  end if;
  if v_platform+p_estimated_cost > p_platform_daily_limit then
    return jsonb_build_object('allowed',false,'reason','PLATFORM_DAILY_MODEL_BUDGET_EXCEEDED','spent',v_platform,'limit',p_platform_daily_limit);
  end if;
  insert into public.model_usage_events(agency_id,client_organization_id,project_id,operation_type,model,estimated_cost,idempotency_key,metadata)
    values(p_agency_id,p_client_organization_id,p_project_id,p_operation_type,p_model,p_estimated_cost,p_idempotency_key,coalesce(p_metadata,'{}'))
    returning * into v_event;
  return jsonb_build_object('allowed',true,'duplicate',false,'usageId',v_event.id,'estimatedCost',v_event.estimated_cost);
end $$;

create or replace function public.settle_model_usage(
  p_usage_id uuid,
  p_status text,
  p_actual_cost numeric,
  p_input_tokens int default 0,
  p_cached_input_tokens int default 0,
  p_output_tokens int default 0,
  p_metadata jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('completed','failed') then raise exception 'INVALID_MODEL_USAGE_STATUS'; end if;
  update public.model_usage_events set status=p_status,actual_cost=greatest(0,p_actual_cost),
    input_tokens=greatest(0,p_input_tokens),cached_input_tokens=greatest(0,p_cached_input_tokens),
    output_tokens=greatest(0,p_output_tokens),metadata=metadata||coalesce(p_metadata,'{}'),settled_at=now()
    where id=p_usage_id and status='reserved';
end $$;

create or replace function public.reserve_agent_service_provider_cost(
  p_enrollment_id uuid,
  p_estimated_cost numeric,
  p_idempotency_key text,
  p_metadata jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.agent_service_enrollments; u public.agent_service_usage; v_base_remaining numeric; v_purchased numeric;
begin
  select * into e from public.agent_service_enrollments where id=p_enrollment_id for update;
  if e.id is null then raise exception 'AGENT_SERVICE_NOT_FOUND'; end if;
  select * into u from public.agent_service_usage where enrollment_id=e.id and idempotency_key=p_idempotency_key;
  if u.id is not null then return jsonb_build_object('allowed',true,'duplicate',true,'usageId',u.id); end if;
  if e.current_period_end <= now() then
    update public.agent_service_enrollments set actions_used=0,provider_spend_used=0,human_review_minutes_used=0,
      current_period_start=now(),current_period_end=now()+interval '1 month',updated_at=now() where id=e.id returning * into e;
  end if;
  v_base_remaining := greatest(0,e.monthly_provider_budget-e.provider_spend_used);
  v_purchased := greatest(0,p_estimated_cost-v_base_remaining);
  if v_purchased > e.purchased_provider_balance then
    return jsonb_build_object('allowed',false,'reason','PROVIDER_BUDGET_EXCEEDED','providerSpendUsed',e.provider_spend_used,
      'providerBudget',e.monthly_provider_budget,'purchasedProviderBalance',e.purchased_provider_balance);
  end if;
  update public.agent_service_enrollments set provider_spend_used=provider_spend_used+p_estimated_cost,
    purchased_provider_balance=purchased_provider_balance-v_purchased,updated_at=now() where id=e.id;
  insert into public.agent_service_usage(enrollment_id,agency_id,client_organization_id,project_id,usage_type,quantity,unit,cost_amount,idempotency_key,metadata)
    values(e.id,e.agency_id,e.client_organization_id,e.project_id,'provider_cost',1,'request',p_estimated_cost,p_idempotency_key,
      coalesce(p_metadata,'{}')||jsonb_build_object('purchasedReserved',v_purchased,'reservationStatus','reserved')) returning * into u;
  return jsonb_build_object('allowed',true,'duplicate',false,'usageId',u.id,'reservedCost',p_estimated_cost);
end $$;

create or replace function public.settle_agent_service_provider_cost(
  p_usage_id uuid,
  p_actual_cost numeric,
  p_status text,
  p_metadata jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.agent_service_usage; e public.agent_service_enrollments; v_actual numeric; v_refund numeric; v_purchased_reserved numeric;
begin
  select * into u from public.agent_service_usage where id=p_usage_id for update;
  if u.id is null or coalesce(u.metadata->>'reservationStatus','') <> 'reserved' then return; end if;
  select * into e from public.agent_service_enrollments where id=u.enrollment_id for update;
  v_actual := case when p_status='completed' then greatest(0,least(p_actual_cost,u.cost_amount)) else 0 end;
  v_refund := u.cost_amount-v_actual;
  v_purchased_reserved := coalesce((u.metadata->>'purchasedReserved')::numeric,0);
  update public.agent_service_enrollments set provider_spend_used=greatest(0,provider_spend_used-v_refund),
    purchased_provider_balance=purchased_provider_balance+least(v_refund,v_purchased_reserved),updated_at=now() where id=e.id;
  update public.agent_service_usage set cost_amount=v_actual,
    metadata=metadata||coalesce(p_metadata,'{}')||jsonb_build_object('reservationStatus',p_status,'reservedCost',u.cost_amount)
    where id=u.id;
end $$;

create or replace function public.consume_agent_service_capacity(
  p_enrollment_id uuid,
  p_action_units int,
  p_provider_cost numeric,
  p_idempotency_key text,
  p_metadata jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.agent_service_enrollments; v_reset boolean := false; v_base_remaining int; v_purchased int;
begin
  select * into e from public.agent_service_enrollments where id=p_enrollment_id for update;
  if e.id is null then raise exception 'AGENT_SERVICE_NOT_FOUND'; end if;
  if exists(select 1 from public.agent_service_usage where enrollment_id=e.id and idempotency_key=p_idempotency_key) then
    return jsonb_build_object('allowed',true,'duplicate',true,'actionsUsed',e.actions_used,'purchasedActionBalance',e.purchased_action_balance);
  end if;
  if e.current_period_end <= now() then
    update public.agent_service_enrollments set actions_used=0,provider_spend_used=0,human_review_minutes_used=0,
      current_period_start=now(),current_period_end=now()+interval '1 month',updated_at=now() where id=e.id returning * into e;
    v_reset := true;
  end if;
  v_base_remaining := greatest(0,e.monthly_action_limit-e.actions_used);
  v_purchased := greatest(0,p_action_units-v_base_remaining);
  if v_purchased > e.purchased_action_balance then
    return jsonb_build_object('allowed',false,'reason','ACTION_CAPACITY_EXCEEDED','actionsUsed',e.actions_used,
      'actionLimit',e.monthly_action_limit,'purchasedActionBalance',e.purchased_action_balance);
  end if;
  if p_provider_cost > 0 then raise exception 'RESERVE_PROVIDER_COST_SEPARATELY'; end if;
  update public.agent_service_enrollments set actions_used=actions_used+p_action_units,
    purchased_action_balance=purchased_action_balance-v_purchased,updated_at=now() where id=e.id returning * into e;
  insert into public.agent_service_usage(enrollment_id,agency_id,client_organization_id,project_id,usage_type,quantity,unit,cost_amount,idempotency_key,metadata)
    values(e.id,e.agency_id,e.client_organization_id,e.project_id,'agent_action',p_action_units,'customer_deliverable',0,p_idempotency_key,
      coalesce(p_metadata,'{}')||jsonb_build_object('purchasedActionsUsed',v_purchased,'creditStatus','reserved'));
  return jsonb_build_object('allowed',true,'duplicate',false,'periodReset',v_reset,'actionsUsed',e.actions_used,
    'actionLimit',e.monthly_action_limit,'purchasedActionBalance',e.purchased_action_balance);
end $$;

create or replace function public.refund_agent_service_capacity(
  p_enrollment_id uuid,
  p_original_idempotency_key text,
  p_refund_idempotency_key text,
  p_reason text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare e public.agent_service_enrollments; u public.agent_service_usage; v_purchased int;
begin
  select * into e from public.agent_service_enrollments where id=p_enrollment_id for update;
  if exists(select 1 from public.agent_service_usage where enrollment_id=p_enrollment_id and idempotency_key=p_refund_idempotency_key) then return false; end if;
  select * into u from public.agent_service_usage where enrollment_id=p_enrollment_id and idempotency_key=p_original_idempotency_key and usage_type='agent_action' for update;
  if u.id is null or coalesce(u.metadata->>'creditStatus','') <> 'reserved' then return false; end if;
  v_purchased := coalesce((u.metadata->>'purchasedActionsUsed')::int,0);
  update public.agent_service_enrollments set actions_used=greatest(0,actions_used-u.quantity::int),
    purchased_action_balance=purchased_action_balance+v_purchased,updated_at=now() where id=e.id;
  update public.agent_service_usage set metadata=metadata||jsonb_build_object('creditStatus','refunded','refundReason',p_reason) where id=u.id;
  insert into public.agent_service_usage(enrollment_id,cycle_id,agency_id,client_organization_id,project_id,usage_type,quantity,unit,cost_amount,idempotency_key,metadata)
    values(e.id,u.cycle_id,e.agency_id,e.client_organization_id,e.project_id,'capacity_refund',u.quantity,'customer_deliverable',0,p_refund_idempotency_key,jsonb_build_object('reason',p_reason,'originalUsageId',u.id));
  return true;
end $$;

revoke all on function public.reserve_model_usage(uuid,uuid,uuid,text,text,numeric,numeric,numeric,text,jsonb) from public,anon,authenticated;
revoke all on function public.settle_model_usage(uuid,text,numeric,int,int,int,jsonb) from public,anon,authenticated;
revoke all on function public.reserve_agent_service_provider_cost(uuid,numeric,text,jsonb) from public,anon,authenticated;
revoke all on function public.settle_agent_service_provider_cost(uuid,numeric,text,jsonb) from public,anon,authenticated;
revoke all on function public.refund_agent_service_capacity(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_model_usage(uuid,uuid,uuid,text,text,numeric,numeric,numeric,text,jsonb) to service_role;
grant execute on function public.settle_model_usage(uuid,text,numeric,int,int,int,jsonb) to service_role;
grant execute on function public.reserve_agent_service_provider_cost(uuid,numeric,text,jsonb) to service_role;
grant execute on function public.settle_agent_service_provider_cost(uuid,numeric,text,jsonb) to service_role;
grant execute on function public.refund_agent_service_capacity(uuid,text,text,text) to service_role;
