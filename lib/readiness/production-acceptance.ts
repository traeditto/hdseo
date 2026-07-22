import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";

import {ApiError} from "@/lib/api/errors";

type ProjectScope={agencyId:string;clientId:string;projectId:string;initiatedBy:string;releaseSha?:string|null;environment?:"staging"|"production"};
type Step={key:string;passed:boolean;evidence:Record<string,unknown>};

const recent=(value:string|undefined|null,maxAgeMs:number)=>Boolean(value&&Date.now()-new Date(value).getTime()<=maxAgeMs);
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

export async function evaluateProductionAcceptance(db:SupabaseClient,input:ProjectScope){
  const idempotencyKey=`acceptance:${input.environment??"production"}:${input.projectId}:${new Date().toISOString().slice(0,13)}`,created=await db.rpc("create_production_acceptance_run",{p_agency_id:input.agencyId,p_client_organization_id:input.clientId,p_project_id:input.projectId,p_environment:input.environment??"production",p_release_sha:input.releaseSha??null,p_idempotency_key:idempotencyKey,p_initiated_by:input.initiatedBy});
  if(created.error||!created.data)throw new ApiError("Production acceptance could not start. Apply migration 0019 and retry.",500,"DATABASE_BINDING_FAILED");
  const runId=String(created.data),startedAt=new Date().toISOString();
  await db.from("production_acceptance_runs").update({status:"running",started_at:startedAt,updated_at:startedAt}).eq("id",runId).eq("agency_id",input.agencyId);

  const [crawl,search,opportunity,agents,legacyApproval,legacyVerification,legacyReporting,actualRollback,outcome]=await Promise.all([
    db.from("evidence_collection_runs").select("id,completed_at,records_written").eq("project_id",input.projectId).eq("run_type","crawl").eq("status","succeeded").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("search_console_rows").select("captured_at",{count:"exact"}).eq("project_id",input.projectId).order("captured_at",{ascending:false}).limit(1),
    db.from("seo_opportunities").select("id,opportunity_score,confidence_score,status").eq("project_id",input.projectId).order("opportunity_score",{ascending:false}).limit(1).maybeSingle(),
    db.from("agent_work_items").select("id,completed_at,status").eq("project_id",input.projectId).eq("status","succeeded").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("agent_approvals").select("id,decided_at,status").eq("project_id",input.projectId).eq("status","approved").order("decided_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("implementation_verifications").select("id,verified_at,status,checks").eq("project_id",input.projectId).eq("status","passed").order("verified_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("reports").select("id,published_at,status").eq("project_id",input.projectId).eq("client_visible",true).not("published_at","is",null).order("published_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("deployments").select("id,completed_at,status").eq("project_id",input.projectId).eq("status","rolled_back").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("outcome_loop_runs").select("id,status,current_step,execution_id,deployment_id,monitoring_plan_id,delivery_kind,delivery_proof,delivered_at,completed_at").eq("project_id",input.projectId).eq("status","completed").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  const modernRun=outcome.data;
  const [outcomeSteps,execution,preview,production,monitoring]=await Promise.all([
    modernRun?db.from("outcome_loop_steps").select("step_key,status,completed_at,deployment_id,monitoring_plan_id").eq("run_id",modernRun.id):Promise.resolve({data:[],error:null}),
    modernRun?.execution_id?db.from("seo_executions").select("id,status,pull_request_url,preview_deployment_id,production_deployed_at,production_commit_sha").eq("id",modernRun.execution_id).maybeSingle():Promise.resolve({data:null,error:null}),
    modernRun?db.from("deployments").select("id,url,status,completed_at").eq("outcome_run_id",modernRun.id).eq("environment","preview").eq("status","healthy").order("completed_at",{ascending:false}).limit(1).maybeSingle():Promise.resolve({data:null,error:null}),
    modernRun?db.from("deployments").select("id,url,status,completed_at,validation_summary,previous_deployment_id,external_deployment_id").eq("outcome_run_id",modernRun.id).eq("environment","production").eq("status","healthy").order("completed_at",{ascending:false}).limit(1).maybeSingle():Promise.resolve({data:null,error:null}),
    modernRun?.monitoring_plan_id?db.from("seo_monitoring_plans").select("id,status,created_at").eq("id",modernRun.monitoring_plan_id).in("status",["scheduled","active","completed"]).maybeSingle():db.from("seo_monitoring_plans").select("id,status,created_at").eq("project_id",input.projectId).in("status",["scheduled","active","completed"]).order("created_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(outcomeSteps.error||execution.error||preview.error||production.error||monitoring.error)throw new ApiError("Modern Autopilot evidence could not be inspected.",500,"DATABASE_BINDING_FAILED");
  const statusByStep=new Map((outcomeSteps.data??[]).map(step=>[step.step_key,step.status])),stepSucceeded=(key:string)=>statusByStep.get(key)==="succeeded";
  const checks=production.data?await db.from("deployment_checks").select("check_type,status,required,completed_at").eq("deployment_id",production.data.id):{data:[],error:null};
  if(checks.error)throw new ApiError("Production validation evidence could not be inspected.",500,"DATABASE_BINDING_FAILED");
  const requiredChecks=(checks.data??[]).filter(check=>check.required),allRequiredChecksPassed=requiredChecks.length>0&&requiredChecks.every(check=>["passed","warning","skipped"].includes(check.status));
  const rollbackBaseline=production.data?.previous_deployment_id?await db.from("deployments").select("id,status,external_deployment_id,url,validation_summary").eq("id",production.data.previous_deployment_id).eq("agency_id",input.agencyId).maybeSingle():{data:null,error:null};
  if(rollbackBaseline.error)throw new ApiError("Rollback readiness evidence could not be inspected.",500,"DATABASE_BINDING_FAILED");
  const rollbackReady=Boolean(production.data?.previous_deployment_id&&rollbackBaseline.data?.external_deployment_id&&["ready","healthy","rolled_back"].includes(rollbackBaseline.data.status));
  const deliveryProof=record(modernRun?.delivery_proof),searchLatest=search.data?.[0]?.captured_at as string|undefined;
  const modernApproval=stepSucceeded("approval"),modernImplementation=stepSucceeded("implementation")&&Boolean(execution.data?.production_deployed_at),modernPreview=stepSucceeded("preview")&&Boolean(preview.data),modernQa=stepSucceeded("qa")&&Boolean(production.data)&&allRequiredChecksPassed,modernProduction=stepSucceeded("publish")&&Boolean(production.data),modernReporting=stepSucceeded("report")&&Boolean(modernRun?.delivered_at)&&Object.keys(deliveryProof).length>0;
  const steps:Step[]=[
    {key:"crawl",passed:Boolean(crawl.data&&Number(crawl.data.records_written)>0&&recent(crawl.data.completed_at,7*86_400_000)),evidence:{runId:crawl.data?.id??null,recordsWritten:crawl.data?.records_written??0,completedAt:crawl.data?.completed_at??null}},
    {key:"search_console",passed:Boolean((search.count??0)>0&&recent(searchLatest,7*86_400_000)),evidence:{rows:search.count??0,lastCapturedAt:searchLatest??null}},
    {key:"opportunity",passed:Boolean(opportunity.data&&Number(opportunity.data.opportunity_score)>0),evidence:{opportunityId:opportunity.data?.id??null,score:opportunity.data?.opportunity_score??null,confidence:opportunity.data?.confidence_score??null}},
    {key:"agents",passed:Boolean(agents.data),evidence:{workItemId:agents.data?.id??null,completedAt:agents.data?.completed_at??null,outcomeRunId:modernRun?.id??null}},
    {key:"approval",passed:Boolean(legacyApproval.data||modernApproval),evidence:{source:modernApproval?"outcome_loop":"legacy",approvalId:legacyApproval.data?.id??null,outcomeRunId:modernRun?.id??null,status:statusByStep.get("approval")??null}},
    {key:"implementation",passed:Boolean(legacyVerification.data||modernImplementation),evidence:{source:modernImplementation?"outcome_loop":"legacy",verificationId:legacyVerification.data?.id??null,executionId:execution.data?.id??null,productionDeployedAt:execution.data?.production_deployed_at??null}},
    {key:"preview",passed:Boolean(modernPreview||legacyVerification.data),evidence:{deploymentId:preview.data?.id??null,url:preview.data?.url??null,completedAt:preview.data?.completed_at??null,status:statusByStep.get("preview")??null}},
    {key:"qa",passed:Boolean((legacyVerification.data&&production.data)||modernQa),evidence:{source:modernQa?"deployment_checks":"legacy",deploymentId:production.data?.id??null,requiredChecks:requiredChecks.map(check=>({type:check.check_type,status:check.status})),validationSummary:production.data?.validation_summary??null}},
    {key:"production",passed:Boolean(production.data&&modernProduction),evidence:{deploymentId:production.data?.id??null,url:production.data?.url??null,completedAt:production.data?.completed_at??null,status:statusByStep.get("publish")??null}},
    {key:"monitoring",passed:Boolean(monitoring.data&&stepSucceeded("monitor")),evidence:{planId:monitoring.data?.id??null,status:monitoring.data?.status??null,outcomeStatus:statusByStep.get("monitor")??null}},
    {key:"reporting",passed:Boolean(legacyReporting.data||modernReporting),evidence:{source:modernReporting?"outcome_delivery":"legacy",reportId:legacyReporting.data?.id??null,outcomeRunId:modernRun?.id??null,deliveryKind:modernRun?.delivery_kind??null,deliveredAt:modernRun?.delivered_at??null,reportStatus:statusByStep.get("report")??null}},
    {key:"rollback",passed:Boolean(actualRollback.data||rollbackReady),evidence:{mode:actualRollback.data?"exercised":rollbackReady?"provider_baseline_ready":"unproven",rollbackDeploymentId:actualRollback.data?.id??null,currentDeploymentId:production.data?.id??null,baselineDeploymentId:rollbackBaseline.data?.id??null,baselineProviderDeploymentId:rollbackBaseline.data?.external_deployment_id??null}},
  ];
  for(const step of steps)await db.from("production_acceptance_steps").update({status:step.passed?"passed":"blocked",evidence:step.evidence,error_code:step.passed?null:"EVIDENCE_NOT_PROVEN",error_message:step.passed?null:"Required production evidence is missing.",started_at:startedAt,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("run_id",runId).eq("step_key",step.key);
  const failed=steps.filter(step=>!step.passed).map(step=>step.key),completedAt=new Date().toISOString(),status=failed.length?"failed":"succeeded";
  await db.from("production_acceptance_runs").update({status,summary:{passed:steps.length-failed.length,required:steps.length,failed,outcomeRunId:modernRun?.id??null},error_code:failed.length?"PRODUCTION_ACCEPTANCE_INCOMPLETE":null,error_message:failed.length?`Missing evidence: ${failed.join(", ")}`:null,completed_at:completedAt,updated_at:completedAt}).eq("id",runId).eq("agency_id",input.agencyId);
  return{runId,status,failed,steps};
}
