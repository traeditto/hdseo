-- Recover a verified customer-visible outcome after an earlier transient
-- failure released its capacity reservation.
--
-- The recovery is intentionally narrower than the normal commit path. It may
-- only run when production, execution, and monitoring ledgers all prove that
-- the exact outcome shipped. The historical release event remains immutable.
-- When the original included slot is no longer available, HD SEO grants a
-- platform recovery credit instead of charging prepaid capacity or creating an
-- overage because the premature release was a platform failure.

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

  -- Repository releases need three mutually consistent production facts. The
  -- service role cannot recover a merely queued, preview, or failed mutation.
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
    -- Non-repository paths are only recoverable when an independently passed
    -- implementation verification and its monitoring plan remain attached.
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

  -- Reclaim the exact capacity that release_outcome_loop_run returned. Never
  -- silently consume a purchased unit to repair an HD SEO orchestration fault.
  if b.capacity_source='included'
    and e.current_period_start=b.period_start
    and e.actions_used<e.monthly_action_limit then
    update public.agent_service_enrollments
      set actions_used=actions_used+1,updated_at=now()
      where id=e.id;
    v_capacity_reclaimed := true;
  elsif b.capacity_source='prepaid' and e.purchased_action_balance>=b.prepaid_units then
    update public.agent_service_enrollments
      set purchased_action_balance=purchased_action_balance-b.prepaid_units,updated_at=now()
      where id=e.id;
    v_capacity_reclaimed := true;
  else
    v_recovery_credit := true;
  end if;

  update public.billable_usage_reservations set
    status='committed',outcome_digest=p_outcome_digest,committed_at=now(),
    released_at=null,
    metadata=metadata||jsonb_build_object(
      'deliveryKind',p_delivery_kind,
      'verifiedRecovery',true,
      'capacityReclaimed',v_capacity_reclaimed,
      'recoveryCredit',v_recovery_credit,
      'recoveredAt',now()
    )
    where id=b.id;

  insert into public.billable_usage_events(
    reservation_id,enrollment_id,outcome_run_id,agency_id,client_organization_id,project_id,
    event_type,event_key,metadata
  ) values(
    b.id,b.enrollment_id,r.id,r.agency_id,r.client_organization_id,r.project_id,
    'committed','outcome:'||r.id||':committed',
    jsonb_build_object(
      'deliveryKind',p_delivery_kind,'outcomeDigest',p_outcome_digest,
      'verifiedRecovery',true,'capacityReclaimed',v_capacity_reclaimed,
      'recoveryCredit',v_recovery_credit
    )
  ) on conflict(event_key) do nothing;

  insert into public.agent_service_usage(
    enrollment_id,cycle_id,agency_id,client_organization_id,project_id,usage_type,
    quantity,unit,cost_amount,idempotency_key,metadata
  ) values(
    b.enrollment_id,r.cycle_id,r.agency_id,r.client_organization_id,r.project_id,'agent_action',
    1,'completed_outcome',0,'outcome:'||r.id||':committed',
    jsonb_build_object(
      'outcomeRunId',r.id,'capacitySource',b.capacity_source,
      'deliveryKind',p_delivery_kind,'outcomeDigest',p_outcome_digest,
      'creditStatus','earned','verifiedRecovery',true,
      'recoveryCredit',v_recovery_credit
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
    'reservationId',b.id,'outcomeRunId',r.id
  );
end $$;

revoke all on function public.commit_verified_recovered_outcome(uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.commit_verified_recovered_outcome(uuid,text,jsonb,text)
  to service_role;
