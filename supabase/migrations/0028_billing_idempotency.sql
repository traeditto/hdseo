-- Credit paid agent capacity exactly once even when Stripe retries or delivers
-- the same checkout event concurrently.

create or replace function public.credit_agent_capacity_purchase(
  p_enrollment_id uuid,
  p_project_id uuid,
  p_units integer,
  p_provider_budget_per_unit numeric,
  p_stripe_event_id text,
  p_amount_paid_cents integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare e public.agent_service_enrollments;
begin
  if p_units < 1 or p_units > 20 or p_provider_budget_per_unit < 0 or
     p_amount_paid_cents < 0 or coalesce(trim(p_stripe_event_id),'') = '' then
    raise exception 'INVALID_CAPACITY_PURCHASE';
  end if;

  select * into e from public.agent_service_enrollments
    where id=p_enrollment_id and project_id=p_project_id for update;
  if e.id is null then raise exception 'AGENT_SERVICE_NOT_FOUND'; end if;

  if exists(select 1 from public.agent_service_usage
    where enrollment_id=e.id and idempotency_key='stripe:'||p_stripe_event_id) then
    return false;
  end if;

  insert into public.agent_service_usage(
    enrollment_id,agency_id,client_organization_id,project_id,usage_type,
    quantity,unit,cost_amount,idempotency_key,metadata
  ) values(
    e.id,e.agency_id,e.client_organization_id,e.project_id,'capacity_purchase',
    p_units,'customer_deliverable',0,'stripe:'||p_stripe_event_id,
    jsonb_build_object(
      'stripeEventId',p_stripe_event_id,
      'amountPaidCents',p_amount_paid_cents,
      'providerBudgetAdded',p_units*p_provider_budget_per_unit
    )
  );

  update public.agent_service_enrollments set
    purchased_action_balance=purchased_action_balance+p_units,
    purchased_provider_balance=purchased_provider_balance+(p_units*p_provider_budget_per_unit),
    updated_at=now()
  where id=e.id;

  return true;
end $$;

revoke all on function public.credit_agent_capacity_purchase(uuid,uuid,integer,numeric,text,integer)
  from public,anon,authenticated;
grant execute on function public.credit_agent_capacity_purchase(uuid,uuid,integer,numeric,text,integer)
  to service_role;
