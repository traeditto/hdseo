import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";

import {ApiError} from "@/lib/api/errors";
import {healthyProductionOutcomeState,healthyProductionStepKeys} from "@/lib/automation/outcome-state";

function assertUpdates(results:Array<{error:unknown}>){
  if(results.some(result=>result.error)){
    throw new ApiError("The healthy production workflow could not be reconciled across every outcome ledger.",500,"DATABASE_BINDING_FAILED");
  }
}

export async function reconcileHealthyProductionOutcome(db:SupabaseClient,input:{
  outcomeRunId:string;
  executionId:string;
  deploymentId:string;
}){
  const now=new Date().toISOString(),state=healthyProductionOutcomeState({...input,now});
  const results=await Promise.all([
    db.from("outcome_loop_runs").update(state.run).eq("id",input.outcomeRunId),
    db.from("agent_service_cycles").update(state.cycle).eq("outcome_run_id",input.outcomeRunId),
    db.from("outcome_loop_steps").update(state.completedStep).eq("run_id",input.outcomeRunId).in("step_key",[...healthyProductionStepKeys]),
    db.from("outcome_loop_steps").update(state.monitorStep).eq("run_id",input.outcomeRunId).eq("step_key","monitor"),
  ]);
  assertUpdates(results);
  return{outcomeRunId:input.outcomeRunId,executionId:input.executionId,deploymentId:input.deploymentId,reconciled:true};
}

export async function reconcileRecentHealthyProductionOutcomes(db:SupabaseClient,limit=20){
  const executions=await db.from("seo_executions")
    .select("id,outcome_run_id")
    .in("status",["production_deployed","monitoring"])
    .not("outcome_run_id","is",null)
    .order("updated_at",{ascending:false})
    .limit(limit);
  if(executions.error)throw new ApiError("Healthy production reconciliation could not read recent executions.",500,"DATABASE_BINDING_FAILED");
  const runIds=[...new Set((executions.data??[]).map(item=>item.outcome_run_id).filter((id):id is string=>typeof id==="string"&&Boolean(id)))];
  if(!runIds.length)return{inspected:0,reconciled:0};
  const [runs,deployments,cycles,steps]=await Promise.all([
    db.from("outcome_loop_runs").select("id,status,current_step,failure_code").in("id",runIds),
    db.from("deployments").select("id,outcome_run_id").in("outcome_run_id",runIds).eq("environment","production").eq("status","healthy").order("updated_at",{ascending:false}),
    db.from("agent_service_cycles").select("outcome_run_id,status,stage,failure_code").in("outcome_run_id",runIds),
    db.from("outcome_loop_steps").select("run_id,step_key,status").in("run_id",runIds).in("step_key",[...healthyProductionStepKeys,"monitor"]),
  ]);
  if(runs.error||deployments.error||cycles.error||steps.error)throw new ApiError("Healthy production reconciliation could not inspect the linked outcome ledgers.",500,"DATABASE_BINDING_FAILED");
  const runById=new Map((runs.data??[]).map(run=>[run.id,run]));
  const deploymentByRun=new Map<string,{id:string}>();
  for(const deployment of deployments.data??[])if(deployment.outcome_run_id&&!deploymentByRun.has(deployment.outcome_run_id))deploymentByRun.set(deployment.outcome_run_id,{id:deployment.id});
  const cycleByRun=new Map((cycles.data??[]).map(cycle=>[cycle.outcome_run_id,cycle]));
  const stepsByRun=new Map<string,Map<string,string>>();
  for(const step of steps.data??[]){
    if(!stepsByRun.has(step.run_id))stepsByRun.set(step.run_id,new Map());
    stepsByRun.get(step.run_id)?.set(step.step_key,step.status);
  }
  let reconciled=0;
  for(const execution of executions.data??[]){
    const runId=execution.outcome_run_id as string|null,deployment=runId?deploymentByRun.get(runId):null;
    if(!runId||!deployment)continue;
    const run=runById.get(runId),cycle=cycleByRun.get(runId),stepState=stepsByRun.get(runId),completedStepsAgree=healthyProductionStepKeys.every(key=>stepState?.get(key)==="succeeded"),monitorState=stepState?.get("monitor");
    const agrees=run?.status==="monitoring"&&run.current_step==="monitor"&&!run.failure_code&&cycle?.status==="monitoring"&&cycle.stage==="monitor"&&!cycle.failure_code&&completedStepsAgree&&["running","succeeded"].includes(monitorState??"");
    if(agrees)continue;
    await reconcileHealthyProductionOutcome(db,{outcomeRunId:runId,executionId:execution.id,deploymentId:deployment.id});
    reconciled++;
  }
  return{inspected:executions.data?.length??0,reconciled};
}
