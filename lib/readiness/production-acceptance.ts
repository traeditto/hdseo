import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/errors";

type ProjectScope={agencyId:string;clientId:string;projectId:string;initiatedBy:string;releaseSha?:string|null;environment?:"staging"|"production"};
type Step={key:string;passed:boolean;evidence:Record<string,unknown>};

const recent=(value:string|undefined|null,maxAgeMs:number)=>Boolean(value&&Date.now()-new Date(value).getTime()<=maxAgeMs);

export async function evaluateProductionAcceptance(db:SupabaseClient,input:ProjectScope){
  const idempotencyKey=`acceptance:${input.environment??"production"}:${input.projectId}:${new Date().toISOString().slice(0,13)}`,created=await db.rpc("create_production_acceptance_run",{p_agency_id:input.agencyId,p_client_organization_id:input.clientId,p_project_id:input.projectId,p_environment:input.environment??"production",p_release_sha:input.releaseSha??null,p_idempotency_key:idempotencyKey,p_initiated_by:input.initiatedBy});
  if(created.error||!created.data)throw new ApiError("Production acceptance could not start. Apply migration 0019 and retry.",500,"DATABASE_BINDING_FAILED");
  const runId=String(created.data),startedAt=new Date().toISOString();
  await db.from("production_acceptance_runs").update({status:"running",started_at:startedAt,updated_at:startedAt}).eq("id",runId).eq("agency_id",input.agencyId);

  const [crawl,search,opportunity,agents,approval,verification,preview,production,monitoring,reporting,rollback]=await Promise.all([
    db.from("evidence_collection_runs").select("id,completed_at,records_written").eq("project_id",input.projectId).eq("run_type","crawl").eq("status","succeeded").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("search_console_rows").select("captured_at",{count:"exact"}).eq("project_id",input.projectId).order("captured_at",{ascending:false}).limit(1),
    db.from("seo_opportunities").select("id,opportunity_score,confidence_score,status").eq("project_id",input.projectId).order("opportunity_score",{ascending:false}).limit(1).maybeSingle(),
    db.from("agent_work_items").select("id,completed_at,status").eq("project_id",input.projectId).eq("status","succeeded").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("agent_approvals").select("id,decided_at,status").eq("project_id",input.projectId).eq("status","approved").order("decided_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("implementation_verifications").select("id,verified_at,status,checks").eq("project_id",input.projectId).eq("status","passed").order("verified_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("deployments").select("id,url,status,completed_at").eq("project_id",input.projectId).eq("environment","preview").eq("status","healthy").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("deployments").select("id,url,status,completed_at,validation_summary").eq("project_id",input.projectId).eq("environment","production").eq("status","healthy").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("seo_monitoring_plans").select("id,status,created_at").eq("project_id",input.projectId).in("status",["scheduled","active","completed"]).order("created_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("reports").select("id,published_at,status").eq("project_id",input.projectId).eq("client_visible",true).not("published_at","is",null).order("published_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("deployments").select("id,completed_at,status").eq("project_id",input.projectId).eq("status","rolled_back").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  const searchLatest=search.data?.[0]?.captured_at as string|undefined,steps:Step[]=[
    {key:"crawl",passed:Boolean(crawl.data&&Number(crawl.data.records_written)>0&&recent(crawl.data.completed_at,7*86_400_000)),evidence:{runId:crawl.data?.id??null,recordsWritten:crawl.data?.records_written??0,completedAt:crawl.data?.completed_at??null}},
    {key:"search_console",passed:Boolean((search.count??0)>0&&recent(searchLatest,7*86_400_000)),evidence:{rows:search.count??0,lastCapturedAt:searchLatest??null}},
    {key:"opportunity",passed:Boolean(opportunity.data&&Number(opportunity.data.opportunity_score)>0),evidence:{opportunityId:opportunity.data?.id??null,score:opportunity.data?.opportunity_score??null,confidence:opportunity.data?.confidence_score??null}},
    {key:"agents",passed:Boolean(agents.data),evidence:{workItemId:agents.data?.id??null,completedAt:agents.data?.completed_at??null}},
    {key:"approval",passed:Boolean(approval.data),evidence:{approvalId:approval.data?.id??null,decidedAt:approval.data?.decided_at??null}},
    {key:"implementation",passed:Boolean(verification.data),evidence:{verificationId:verification.data?.id??null,verifiedAt:verification.data?.verified_at??null}},
    {key:"preview",passed:Boolean(preview.data),evidence:{deploymentId:preview.data?.id??null,url:preview.data?.url??null,completedAt:preview.data?.completed_at??null}},
    {key:"qa",passed:Boolean(verification.data&&production.data),evidence:{verificationId:verification.data?.id??null,deploymentId:production.data?.id??null,validationSummary:production.data?.validation_summary??null}},
    {key:"production",passed:Boolean(production.data),evidence:{deploymentId:production.data?.id??null,url:production.data?.url??null,completedAt:production.data?.completed_at??null}},
    {key:"monitoring",passed:Boolean(monitoring.data),evidence:{planId:monitoring.data?.id??null,status:monitoring.data?.status??null}},
    {key:"reporting",passed:Boolean(reporting.data),evidence:{reportId:reporting.data?.id??null,publishedAt:reporting.data?.published_at??null}},
    {key:"rollback",passed:Boolean(rollback.data),evidence:{deploymentId:rollback.data?.id??null,completedAt:rollback.data?.completed_at??null}},
  ];
  for(const step of steps)await db.from("production_acceptance_steps").update({status:step.passed?"passed":"blocked",evidence:step.evidence,error_code:step.passed?null:"EVIDENCE_NOT_PROVEN",error_message:step.passed?null:"Required production evidence is missing.",started_at:startedAt,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("run_id",runId).eq("step_key",step.key);
  const failed=steps.filter(step=>!step.passed).map(step=>step.key),completedAt=new Date().toISOString(),status=failed.length?"failed":"succeeded";
  await db.from("production_acceptance_runs").update({status,summary:{passed:steps.length-failed.length,required:steps.length,failed},error_code:failed.length?"PRODUCTION_ACCEPTANCE_INCOMPLETE":null,error_message:failed.length?`Missing evidence: ${failed.join(", ")}`:null,completed_at:completedAt,updated_at:completedAt}).eq("id",runId).eq("agency_id",input.agencyId);
  return{runId,status,failed,steps};
}
