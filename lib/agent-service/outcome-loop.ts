import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";

import {ApiError} from "@/lib/api/errors";
import {actionDigest} from "@/lib/safety/action-digest";

export type OutcomeStepKey=
  |"evidence"|"research"|"strategy"|"content"|"approval"|"implementation"
  |"preview"|"qa"|"publish"|"monitor"|"report";

export type OutcomeReservation={
  allowed:boolean;
  duplicate?:boolean;
  runId:string;
  reservationId?:string;
  capacitySource?:"included"|"prepaid";
  reason?:string;
  actionsUsed?:number;
  actionLimit?:number;
  purchasedActionBalance?:number;
  capacityUnits?:number;
};

const migrationMessage="The billable outcome ledger is not installed. Apply migration 0038 before running managed agents.";

export async function reserveOutcome(db:SupabaseClient,input:{
  enrollmentId:string;cycleId:string;opportunityId:string;requestedBy:string|null;
  runKey:string;triggerType:"scheduled"|"manual"|"onboarding"|"recovery";
  expectedValue:number|null;capacityUnits:number;planSnapshot:Record<string,unknown>;
}){
  const result=await db.rpc("start_outcome_loop_run_v2",{
    p_enrollment_id:input.enrollmentId,
    p_cycle_id:input.cycleId,
    p_opportunity_id:input.opportunityId,
    p_requested_by:input.requestedBy,
    p_run_key:input.runKey,
    p_trigger_type:input.triggerType,
    p_expected_value:input.expectedValue,
    p_capacity_units:input.capacityUnits,
    p_plan_snapshot:input.planSnapshot,
  });
  if(result.error)throw new ApiError(migrationMessage,503,"DATABASE_BINDING_FAILED");
  return result.data as OutcomeReservation;
}

export async function setOutcomeStep(db:SupabaseClient,input:{
  runId:string;stepKey:OutcomeStepKey;status:string;workItemId?:string|null;
  deploymentId?:string|null;monitoringPlanId?:string|null;
  evidence?:Record<string,unknown>;output?:Record<string,unknown>;
}){
  const updated=await db.from("outcome_loop_steps").update({
    status:input.status,
    work_item_id:input.workItemId,
    deployment_id:input.deploymentId,
    monitoring_plan_id:input.monitoringPlanId,
    evidence:input.evidence,
    output:input.output,
    started_at:["queued","running","awaiting_approval","waiting"].includes(input.status)?new Date().toISOString():undefined,
    completed_at:["succeeded","skipped","failed","cancelled"].includes(input.status)?new Date().toISOString():undefined,
    updated_at:new Date().toISOString(),
  }).eq("run_id",input.runId).eq("step_key",input.stepKey);
  if(updated.error)throw new ApiError(migrationMessage,503,"DATABASE_BINDING_FAILED");
}

export async function releaseOutcome(db:SupabaseClient,input:{runId:string;reason:string;status?:"released"|"failed"|"cancelled"|"blocked"}){
  const result=await db.rpc("release_outcome_loop_run",{
    p_run_id:input.runId,
    p_reason:input.reason,
    p_final_status:input.status??"released",
  });
  if(result.error)throw new ApiError("Managed capacity could not be released safely.",503,"DATABASE_BINDING_FAILED");
  return Boolean(result.data);
}

export async function commitOutcome(db:SupabaseClient,input:{
  runId:string;
  deliveryKind:"repository_release"|"cms_publication"|"verified_manual_implementation"|"approved_deliverable";
  proof:Record<string,unknown>;
}){
  const proof={...input.proof,outcomeRunId:input.runId};
  const digest=actionDigest(proof);
  const result=await db.rpc("commit_outcome_loop_run",{
    p_run_id:input.runId,
    p_delivery_kind:input.deliveryKind,
    p_delivery_proof:proof,
    p_outcome_digest:digest,
  });
  if(!result.error)return{committed:Boolean(result.data),digest,recovered:false};

  // A transient deployment failure may release capacity before an eventually
  // successful provider deployment is reconciled. Only invoke the narrow,
  // proof-enforcing recovery transaction for that exact ledger state.
  const reservation=await db.from("billable_usage_reservations")
    .select("status")
    .eq("outcome_run_id",input.runId)
    .maybeSingle();
  if(reservation.error||reservation.data?.status!=="released"){
    throw new ApiError("The verified outcome could not be committed to the usage ledger.",503,"DATABASE_BINDING_FAILED");
  }
  const recovered=await db.rpc("commit_verified_recovered_outcome",{
    p_run_id:input.runId,
    p_delivery_kind:input.deliveryKind,
    p_delivery_proof:proof,
    p_outcome_digest:digest,
  });
  if(recovered.error){
    throw new ApiError("The verified recovered outcome could not be committed to the usage ledger.",503,"DATABASE_BINDING_FAILED");
  }
  const recovery=recovered.data&&typeof recovered.data==="object"
    ?recovered.data as Record<string,unknown>:{};
  return{committed:Boolean(recovery.committed),digest,recovered:true};
}
