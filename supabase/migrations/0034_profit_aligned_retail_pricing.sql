-- Align advertised retail pricing with the entitlements enforced by the agent
-- control plane. Third-party SEO spending remains separate and approval-gated.

alter table public.client_subscriptions
  drop constraint if exists client_subscriptions_plan_key_check;
alter table public.client_subscriptions
  add constraint client_subscriptions_plan_key_check
  check(plan_key in ('free_audit','starter','growth','pro','autopilot_plus'));

alter table public.agent_service_enrollments
  add column if not exists monthly_major_page_limit integer not null default 0
    check(monthly_major_page_limit >= 0);

-- Retail plan mapping:
-- starter = Essentials, growth = Growth Copilot, pro = Autopilot.
-- The legacy keys remain stable so existing subscriptions can be upgraded
-- without rewriting Stripe or customer history.
update public.agent_service_enrollments
set monthly_action_limit = case plan_key
      when 'starter' then 2
      when 'growth' then 6
      when 'pro' then 6
      when 'autopilot_plus' then 10
      else monthly_action_limit
    end,
    monthly_major_page_limit = case plan_key
      when 'starter' then 0
      when 'growth' then 0
      when 'pro' then 1
      when 'autopilot_plus' then 2
      when 'agency_core' then 1
      when 'agency_scale' then 2
      else monthly_major_page_limit
    end,
    monthly_provider_budget = case plan_key
      when 'starter' then least(monthly_provider_budget,3)
      when 'growth' then least(monthly_provider_budget,5)
      when 'pro' then least(monthly_provider_budget,10)
      when 'autopilot_plus' then least(monthly_provider_budget,18)
      else monthly_provider_budget
    end,
    monthly_human_review_minutes = case plan_key
      when 'starter' then 0
      when 'growth' then 0
      when 'pro' then 30
      when 'autopilot_plus' then 60
      else monthly_human_review_minutes
    end,
    cycle_cadence_hours = case plan_key
      when 'starter' then 720
      when 'growth' then 168
      when 'pro' then 72
      when 'autopilot_plus' then 24
      else cycle_cadence_hours
    end,
    service_mode = case
      when billing_owner='client' and plan_key in ('starter','growth') then 'copilot'
      when billing_owner='client' and plan_key in ('pro','autopilot_plus') then 'managed_agent'
      else service_mode
    end,
    updated_at = now()
where plan_key in ('starter','growth','pro','autopilot_plus','agency_core','agency_scale');

create or replace function public.consume_agent_service_major_page(
  p_enrollment_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.agent_service_enrollments;
  v_used integer;
begin
  select * into e from public.agent_service_enrollments
    where id=p_enrollment_id for update;
  if e.id is null then raise exception 'AGENT_SERVICE_NOT_FOUND'; end if;

  if exists(
    select 1 from public.agent_service_usage
    where enrollment_id=e.id and idempotency_key=p_idempotency_key
  ) then
    select coalesce(sum(quantity),0)::integer into v_used
      from public.agent_service_usage
      where enrollment_id=e.id and usage_type='page_build'
        and occurred_at >= e.current_period_start;
    return jsonb_build_object('allowed',true,'duplicate',true,
      'majorPagesUsed',v_used,'majorPageLimit',e.monthly_major_page_limit);
  end if;

  if e.current_period_end <= now() then
    update public.agent_service_enrollments
      set actions_used=0,provider_spend_used=0,human_review_minutes_used=0,
        current_period_start=now(),current_period_end=now()+interval '1 month',updated_at=now()
      where id=e.id returning * into e;
  end if;

  select coalesce(sum(quantity),0)::integer into v_used
    from public.agent_service_usage
    where enrollment_id=e.id and usage_type='page_build'
      and occurred_at >= e.current_period_start;

  if v_used + 1 > e.monthly_major_page_limit then
    return jsonb_build_object('allowed',false,'reason','MAJOR_PAGE_CAPACITY_EXCEEDED',
      'majorPagesUsed',v_used,'majorPageLimit',e.monthly_major_page_limit);
  end if;

  insert into public.agent_service_usage(
    enrollment_id,agency_id,client_organization_id,project_id,
    usage_type,quantity,unit,cost_amount,idempotency_key,metadata
  ) values(
    e.id,e.agency_id,e.client_organization_id,e.project_id,
    'page_build',1,'major_page',0,p_idempotency_key,coalesce(p_metadata,'{}')
  );

  return jsonb_build_object('allowed',true,'duplicate',false,
    'majorPagesUsed',v_used+1,'majorPageLimit',e.monthly_major_page_limit);
end $$;

revoke all on function public.consume_agent_service_major_page(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.consume_agent_service_major_page(uuid,text,jsonb)
  to service_role;
