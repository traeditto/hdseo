-- Flexible outcome-focused execution capacity.
--
-- Customers buy a bounded monthly execution allocation, not an arbitrary
-- number of tiny tasks. A single evidence-backed focus campaign can reserve
-- the whole allocation, while smaller improvements use weighted units.
-- Reservations are still committed only after independently verified
-- delivery and are returned exactly once when work does not ship.

alter table public.billable_usage_reservations
  drop constraint if exists billable_usage_reservations_quantity_check,
  drop constraint if exists billable_usage_reservations_capacity_source_check,
  drop constraint if exists billable_usage_reservations_included_units_check,
  drop constraint if exists billable_usage_reservations_prepaid_units_check,
  drop constraint if exists billable_usage_reservations_check,
  drop constraint if exists billable_usage_reservations_check1;

alter table public.billable_usage_reservations
  add constraint billable_usage_reservations_quantity_capacity_check
    check(quantity between 1 and 1000),
  add constraint billable_usage_reservations_capacity_source_v2_check
    check(capacity_source in ('included','prepaid','mixed')),
  add constraint billable_usage_reservations_included_units_v2_check
    check(included_units between 0 and 1000),
  add constraint billable_usage_reservations_prepaid_units_v2_check
    check(prepaid_units between 0 and 1000),
  add constraint billable_usage_reservations_unit_sum_v2_check
    check(included_units+prepaid_units=quantity),
  add constraint billable_usage_reservations_source_v2_check
    check(
      (capacity_source='included' and included_units=quantity and prepaid_units=0 and unit_price_cents=0)
      or (capacity_source='prepaid' and included_units=0 and prepaid_units=quantity and unit_price_cents>0)
      or (capacity_source='mixed' and included_units>0 and prepaid_units>0 and unit_price_cents>0)
    );

alter table public.billable_usage_events
  drop constraint if exists billable_usage_events_quantity_check;
alter table public.billable_usage_events
  add constraint billable_usage_events_quantity_capacity_check
    check(quantity between 1 and 1000);

create or replace function public.start_outcome_loop_run_v2(
  p_enrollment_id uuid,
  p_cycle_id uuid,
  p_opportunity_id uuid,
  p_requested_by uuid,
  p_run_key text,
  p_trigger_type text default 'scheduled',
  p_expected_value numeric default null,
  p_capacity_units integer default 1,
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
  v_base_remaining integer := 0;
  v_duplicate boolean := false;
begin
  if coalesce(trim(p_run_key),'')='' or p_trigger_type not in ('scheduled','manual','onboarding','recovery') then
    raise exception 'INVALID_OUTCOME_RUN';
  end if;
  if p_expected_value is not null and p_expected_value < 0 then raise exception 'INVALID_EXPECTED_VALUE'; end if;
  if p_capacity_units < 1 or p_capacity_units > 1000 then raise exception 'INVALID_CAPACITY_UNITS'; end if;
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
    if r.cycle_id<>c.id or r.opportunity_id is distinct from p_opportunity_id then
      raise exception 'OUTCOME_RUN_KEY_CONFLICT';
    end if;
    select * into b from public.billable_usage_reservations where outcome_run_id=r.id;
    if b.id is not null then
      if b.status='reserved' then
        return jsonb_build_object(
          'allowed',true,'duplicate',true,'runId',r.id,'reservationId',b.id,
          'status',r.status,'reason',null,'capacityUnits',b.quantity
        );
      end if;
      return jsonb_build_object(
        'allowed',false,'duplicate',true,'runId',r.id,'reservationId',b.id,
        'status',r.status,'reason','OUTCOME_RUN_ALREADY_FINAL','capacityUnits',b.quantity
      );
    end if;
    if r.status<>'blocked' or r.failure_code<>'CHECKOUT_REQUIRED' then
      return jsonb_build_object(
        'allowed',false,'duplicate',true,'runId',r.id,
        'status',r.status,'reason','OUTCOME_RUN_NOT_RESERVABLE'
      );
    end if;
    v_duplicate := true;
  end if;

  if e.current_period_end <= now() then
    update public.agent_service_enrollments set
      actions_used=0,provider_spend_used=0,human_review_minutes_used=0,
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
      coalesce(p_plan_snapshot,'{}')||jsonb_build_object('capacityUnits',p_capacity_units),
      p_expected_value
    ) returning * into r;
  end if;

  v_base_remaining := greatest(0,e.monthly_action_limit-e.actions_used);
  v_included := least(p_capacity_units,v_base_remaining);
  v_prepaid := p_capacity_units-v_included;

  if v_prepaid > e.purchased_action_balance then
    update public.outcome_loop_runs set
      status='blocked',current_step='capacity',failure_code='CHECKOUT_REQUIRED',
      failure_message='The selected campaign requires more execution capacity than is currently available.',
      updated_at=now()
    where id=r.id;
    update public.agent_service_cycles set
      outcome_run_id=r.id,status='blocked',stage='capacity',
      failure_code='CHECKOUT_REQUIRED',
      failure_message='The selected campaign requires more execution capacity than is currently available.',
      completed_at=now(),updated_at=now()
    where id=c.id;
    return jsonb_build_object(
      'allowed',false,'duplicate',v_duplicate,'runId',r.id,'reason','CHECKOUT_REQUIRED',
      'capacityUnits',p_capacity_units,'actionsUsed',e.actions_used,
      'actionLimit',e.monthly_action_limit,
      'purchasedActionBalance',e.purchased_action_balance
    );
  end if;

  v_source := case
    when v_prepaid=0 then 'included'
    when v_included=0 then 'prepaid'
    else 'mixed'
  end;

  update public.agent_service_enrollments set
    actions_used=actions_used+p_capacity_units,
    purchased_action_balance=purchased_action_balance-v_prepaid,
    updated_at=now()
  where id=e.id returning * into e;

  insert into public.billable_usage_reservations(
    agency_id,client_organization_id,project_id,enrollment_id,outcome_run_id,
    unit_key,quantity,capacity_source,included_units,prepaid_units,
    unit_price_cents,customer_amount_cents,period_start,period_end,
    idempotency_key,metadata
  ) values(
    e.agency_id,e.client_organization_id,e.project_id,e.id,r.id,
    'outcome_action',p_capacity_units,v_source,v_included,v_prepaid,
    case when v_prepaid>0 then 1500 else 0 end,0,
    e.current_period_start,e.current_period_end,'outcome:'||r.id,
    jsonb_build_object(
      'cycleId',c.id,'opportunityId',p_opportunity_id,
      'definition','weighted execution capacity for one verified customer outcome',
      'capacityUnits',p_capacity_units
    )
  ) returning * into b;

  insert into public.billable_usage_events(
    reservation_id,enrollment_id,outcome_run_id,agency_id,client_organization_id,project_id,
    event_type,quantity,event_key,metadata
  ) values(
    b.id,e.id,r.id,e.agency_id,e.client_organization_id,e.project_id,
    'reserved',p_capacity_units,'outcome:'||r.id||':reserved',
    jsonb_build_object('capacitySource',v_source,'capacityUnits',p_capacity_units)
  );

  insert into public.outcome_loop_steps(
    run_id,agency_id,client_organization_id,project_id,sequence,step_key,step_kind
  )
  select r.id,e.agency_id,e.client_organization_id,e.project_id,s.sequence,s.step_key,s.step_kind
  from (values
    (1,'evidence','evidence'),(2,'research','research'),(3,'strategy','strategy'),
    (4,'content','content'),(5,'approval','approval'),(6,'implementation','implementation'),
    (7,'preview','preview'),(8,'qa','qa'),(9,'publish','publish'),
    (10,'monitor','monitor'),(11,'report','report')
  ) as s(sequence,step_key,step_kind)
  on conflict(run_id,step_key) do nothing;

  update public.outcome_loop_runs set
    status='analyzing',current_step='evidence',failure_code=null,
    failure_message=null,completed_at=null,updated_at=now()
  where id=r.id;
  update public.agent_service_cycles set
    outcome_run_id=r.id,status='running',stage='evidence',failure_code=null,
    failure_message=null,completed_at=null,updated_at=now()
  where id=c.id;

  return jsonb_build_object(
    'allowed',true,'duplicate',v_duplicate,'runId',r.id,'reservationId',b.id,
    'capacitySource',v_source,'capacityUnits',p_capacity_units,
    'actionsUsed',e.actions_used,'actionLimit',e.monthly_action_limit,
    'purchasedActionBalance',e.purchased_action_balance
  );
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
    or coalesce(trim(p_outcome_digest),'')=''
    or jsonb_typeof(coalesce(p_delivery_proof,'{}'))<>'object'
    or coalesce(p_delivery_proof,'{}')='{}'::jsonb then
    raise exception 'INVALID_DELIVERY_PROOF';
  end if;
  select * into r from public.outcome_loop_runs where id=p_run_id for update;
  if r.id is null then raise exception 'OUTCOME_RUN_NOT_FOUND'; end if;
  select * into b from public.billable_usage_reservations where outcome_run_id=r.id for update;
  if b.id is null then raise exception 'OUTCOME_RESERVATION_NOT_FOUND'; end if;
  if b.status='committed' then return false; end if;
  if b.status<>'reserved' then raise exception 'OUTCOME_RESERVATION_NOT_COMMITTABLE'; end if;

  update public.billable_usage_reservations set
    status='committed',outcome_digest=p_outcome_digest,committed_at=now(),
    metadata=metadata||jsonb_build_object('deliveryKind',p_delivery_kind)
  where id=b.id;
  insert into public.billable_usage_events(
    reservation_id,enrollment_id,outcome_run_id,agency_id,client_organization_id,project_id,
    event_type,quantity,event_key,metadata
  ) values(
    b.id,b.enrollment_id,r.id,r.agency_id,r.client_organization_id,r.project_id,
    'committed',b.quantity,'outcome:'||r.id||':committed',
    jsonb_build_object(
      'deliveryKind',p_delivery_kind,'outcomeDigest',p_outcome_digest,
      'capacityUnits',b.quantity
    )
  ) on conflict(event_key) do nothing;
  insert into public.agent_service_usage(
    enrollment_id,cycle_id,agency_id,client_organization_id,project_id,usage_type,
    quantity,unit,cost_amount,idempotency_key,metadata
  ) values(
    b.enrollment_id,r.cycle_id,r.agency_id,r.client_organization_id,r.project_id,
    'agent_action',b.quantity,'execution_capacity_unit',0,
    'outcome:'||r.id||':committed',
    jsonb_build_object(
      'outcomeRunId',r.id,'capacitySource',b.capacity_source,
      'deliveryKind',p_delivery_kind,'outcomeDigest',p_outcome_digest,
      'creditStatus','earned','capacityUnits',b.quantity
    )
  ) on conflict(enrollment_id,idempotency_key) do nothing;
  update public.outcome_loop_runs set
    status='completed',current_step='report',delivery_kind=p_delivery_kind,
    delivery_proof=coalesce(p_delivery_proof,'{}'),
    delivered_at=coalesce(delivered_at,now()),billed_at=now(),
    completed_at=now(),updated_at=now()
  where id=r.id;
  update public.agent_service_cycles set
    status='succeeded',stage='outcome',delivery_kind=p_delivery_kind,
    delivered_at=now(),usage_settled_at=now(),completed_at=now(),
    recommendation=null,updated_at=now()
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
  if p_final_status not in ('released','failed','cancelled','blocked') then
    raise exception 'INVALID_FINAL_STATUS';
  end if;
  select * into r from public.outcome_loop_runs where id=p_run_id for update;
  if r.id is null then raise exception 'OUTCOME_RUN_NOT_FOUND'; end if;
  select * into b from public.billable_usage_reservations where outcome_run_id=r.id for update;
  if b.id is null or b.status in ('released','credited') then return false; end if;
  if b.status='committed' then raise exception 'COMMITTED_OUTCOME_REQUIRES_CREDIT'; end if;
  select * into e from public.agent_service_enrollments where id=b.enrollment_id for update;
  update public.agent_service_enrollments set
    actions_used=case
      when current_period_start=b.period_start then greatest(0,actions_used-b.quantity)
      else actions_used
    end,
    purchased_action_balance=purchased_action_balance+b.prepaid_units,
    updated_at=now()
  where id=e.id;
  update public.billable_usage_reservations set
    status='released',released_at=now(),
    metadata=metadata||jsonb_build_object(
      'releaseReason',left(coalesce(p_reason,'Not delivered'),500)
    )
  where id=b.id;
  insert into public.billable_usage_events(
    reservation_id,enrollment_id,outcome_run_id,agency_id,client_organization_id,project_id,
    event_type,quantity,event_key,metadata
  ) values(
    b.id,b.enrollment_id,r.id,r.agency_id,r.client_organization_id,r.project_id,
    'released',b.quantity,'outcome:'||r.id||':released',
    jsonb_build_object(
      'reason',left(coalesce(p_reason,'Not delivered'),500),
      'capacityUnits',b.quantity
    )
  ) on conflict(event_key) do nothing;
  update public.outcome_loop_runs set
    status=p_final_status,current_step='complete',failure_code=upper(p_final_status),
    failure_message=left(coalesce(p_reason,'Not delivered'),500),
    completed_at=now(),updated_at=now()
  where id=r.id;
  update public.agent_service_cycles set
    status=case when p_final_status in ('cancelled','released') then 'canceled' else p_final_status end,
    stage='outcome',failure_code=upper(p_final_status),
    failure_message=left(coalesce(p_reason,'Not delivered'),500),
    usage_settled_at=now(),completed_at=now(),updated_at=now()
  where id=r.cycle_id;
  return true;
end $$;

revoke all on function public.start_outcome_loop_run_v2(uuid,uuid,uuid,uuid,text,text,numeric,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.start_outcome_loop_run_v2(uuid,uuid,uuid,uuid,text,text,numeric,integer,jsonb)
  to service_role;

create or replace function public.commit_verified_recovered_outcome(
  p_run_id uuid,
  p_delivery_kind text,
  p_delivery_proof jsonb,
  p_outcome_digest text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.outcome_loop_runs;
  b public.billable_usage_reservations;
  e public.agent_service_enrollments;
  x public.seo_executions;
  d public.deployments;
  m public.seo_monitoring_plans;
  v_capacity_reclaimed boolean := false;
  v_recovery_credit boolean := false;
  v_base_available integer := 0;
begin
  if p_delivery_kind not in (
      'repository_release','cms_publication','verified_manual_implementation','approved_deliverable'
    )
    or coalesce(trim(p_outcome_digest),'')=''
    or jsonb_typeof(coalesce(p_delivery_proof,'{}'))<>'object'
    or coalesce(p_delivery_proof,'{}')='{}'::jsonb then
    raise exception 'INVALID_DELIVERY_PROOF';
  end if;

  select * into r from public.outcome_loop_runs where id=p_run_id for update;
  if r.id is null then raise exception 'OUTCOME_RUN_NOT_FOUND'; end if;
  select * into b from public.billable_usage_reservations
    where outcome_run_id=r.id for update;
  if b.id is null then raise exception 'OUTCOME_RESERVATION_NOT_FOUND'; end if;

  if b.status='committed' or r.status='completed' then
    return jsonb_build_object(
      'committed',false,'duplicate',true,'recovered',true,
      'reservationId',b.id,'outcomeRunId',r.id
    );
  end if;
  if b.status<>'released' then raise exception 'OUTCOME_RESERVATION_NOT_RECOVERABLE'; end if;

  if p_delivery_kind='repository_release' then
    if r.execution_id is null or r.deployment_id is null or r.monitoring_plan_id is null then
      raise exception 'VERIFIED_RECOVERY_PROOF_INCOMPLETE';
    end if;
    select * into x from public.seo_executions
      where id=r.execution_id and outcome_run_id=r.id for update;
    if x.id is null or x.production_deployed_at is null
      or x.status not in ('production_deployed','monitoring') then
      raise exception 'VERIFIED_RECOVERY_EXECUTION_MISSING';
    end if;
    select * into d from public.deployments
      where id=r.deployment_id and outcome_run_id=r.id for update;
    if d.id is null or d.environment<>'production' or d.status<>'healthy'
      or d.completed_at is null then
      raise exception 'VERIFIED_RECOVERY_DEPLOYMENT_MISSING';
    end if;
    select * into m from public.seo_monitoring_plans
      where id=r.monitoring_plan_id and outcome_run_id=r.id
        and execution_id=r.execution_id for update;
    if m.id is null or m.status not in ('scheduled','active','monitoring','completed') then
      raise exception 'VERIFIED_RECOVERY_MONITORING_MISSING';
    end if;
  else
    if r.implementation_package_id is null or r.monitoring_plan_id is null
      or not exists(
        select 1 from public.implementation_verifications v
        where v.package_id=r.implementation_package_id and v.status='passed'
      )
      or not exists(
        select 1 from public.seo_monitoring_plans mp
        where mp.id=r.monitoring_plan_id and mp.outcome_run_id=r.id
      ) then
      raise exception 'VERIFIED_RECOVERY_PROOF_INCOMPLETE';
    end if;
  end if;

  select * into e from public.agent_service_enrollments
    where id=b.enrollment_id for update;
  if e.id is null then raise exception 'OUTCOME_ENROLLMENT_NOT_FOUND'; end if;
  v_base_available := greatest(0,e.monthly_action_limit-e.actions_used);

  -- Reclaim all of the original weighted reservation or issue a platform
  -- recovery credit. Never partially charge a recovered campaign.
  if e.current_period_start=b.period_start
    and v_base_available>=b.included_units
    and e.purchased_action_balance>=b.prepaid_units then
    update public.agent_service_enrollments set
      actions_used=actions_used+b.quantity,
      purchased_action_balance=purchased_action_balance-b.prepaid_units,
      updated_at=now()
    where id=e.id;
    v_capacity_reclaimed := true;
  else
    v_recovery_credit := true;
  end if;

  update public.billable_usage_reservations set
    status='committed',outcome_digest=p_outcome_digest,committed_at=now(),
    released_at=null,
    metadata=metadata||jsonb_build_object(
      'deliveryKind',p_delivery_kind,'verifiedRecovery',true,
      'capacityReclaimed',v_capacity_reclaimed,
      'recoveryCredit',v_recovery_credit,'recoveredAt',now(),
      'capacityUnits',b.quantity
    )
  where id=b.id;

  insert into public.billable_usage_events(
    reservation_id,enrollment_id,outcome_run_id,agency_id,client_organization_id,project_id,
    event_type,quantity,event_key,metadata
  ) values(
    b.id,b.enrollment_id,r.id,r.agency_id,r.client_organization_id,r.project_id,
    'committed',b.quantity,'outcome:'||r.id||':committed',
    jsonb_build_object(
      'deliveryKind',p_delivery_kind,'outcomeDigest',p_outcome_digest,
      'verifiedRecovery',true,'capacityReclaimed',v_capacity_reclaimed,
      'recoveryCredit',v_recovery_credit,'capacityUnits',b.quantity
    )
  ) on conflict(event_key) do nothing;

  insert into public.agent_service_usage(
    enrollment_id,cycle_id,agency_id,client_organization_id,project_id,usage_type,
    quantity,unit,cost_amount,idempotency_key,metadata
  ) values(
    b.enrollment_id,r.cycle_id,r.agency_id,r.client_organization_id,r.project_id,
    'agent_action',b.quantity,'execution_capacity_unit',0,
    'outcome:'||r.id||':committed',
    jsonb_build_object(
      'outcomeRunId',r.id,'capacitySource',b.capacity_source,
      'deliveryKind',p_delivery_kind,'outcomeDigest',p_outcome_digest,
      'creditStatus','earned','verifiedRecovery',true,
      'recoveryCredit',v_recovery_credit,'capacityUnits',b.quantity
    )
  ) on conflict(enrollment_id,idempotency_key) do nothing;

  update public.outcome_loop_runs set
    status='completed',current_step='report',delivery_kind=p_delivery_kind,
    delivery_proof=coalesce(p_delivery_proof,'{}'),
    delivered_at=coalesce(delivered_at,now()),billed_at=now(),
    failure_code=null,failure_message=null,completed_at=now(),updated_at=now()
  where id=r.id;
  update public.agent_service_cycles set
    status='succeeded',stage='outcome',delivery_kind=p_delivery_kind,
    delivered_at=coalesce(delivered_at,now()),usage_settled_at=now(),
    completed_at=now(),recommendation=null,failure_code=null,failure_message=null,
    updated_at=now()
  where id=r.cycle_id;
  update public.agent_service_escalations set
    status='resolved',
    resolution='Verified production delivery recovered and committed automatically.',
    resolved_at=now(),updated_at=now()
  where enrollment_id=b.enrollment_id and cycle_id=r.cycle_id and status='open'
    and escalation_type in ('worker','billing')
    and coalesce(metadata->>'source','')='agent_service_outcome_loop';

  return jsonb_build_object(
    'committed',true,'duplicate',false,'recovered',true,
    'capacityReclaimed',v_capacity_reclaimed,'recoveryCredit',v_recovery_credit,
    'capacityUnits',b.quantity,'reservationId',b.id,'outcomeRunId',r.id
  );
end $$;

revoke all on function public.commit_verified_recovered_outcome(uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.commit_verified_recovered_outcome(uuid,text,jsonb,text)
  to service_role;
