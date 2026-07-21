import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";

import {ApiError} from "@/lib/api/errors";
import {enqueueAgentWorkItem,resumeEvidenceBlockedAgentWork} from "@/lib/agents/control-plane";
import {upgradeLegacyManagedTools} from "@/lib/agent-service/catalog";
import {commitOutcome,releaseOutcome,reserveOutcome,setOutcomeStep,type OutcomeStepKey} from "@/lib/agent-service/outcome-loop";
import {getLiveAdminClient} from "@/lib/live/identity";

type Enrollment={
  id:string;agency_id:string;client_organization_id:string;client_id:string;project_id:string;
  created_by:string|null;approval_owner:"agency"|"client"|"both";monthly_action_limit:number;
  actions_used:number;monthly_provider_budget:number;provider_spend_used:number;cycle_cadence_hours:number;
  status:string;risk_ceiling:"low"|"medium"|"high";allowed_tools:string[];external_spend_requires_approval:boolean;
};
type Cycle={id:string;outcome_run_id:string|null;campaign_job_id:string|null;work_item_ids:string[];selected_opportunity_id:string|null;status:string};
type Work={id:string;work_type:string;status:string;final_outcome:Record<string,unknown>|null};
type Run={id:string;status:string;campaign_job_id:string|null};
type Campaign={id:string;status:string;current_stage:string;result:Record<string,unknown>;error_code:string|null;error_message:string|null};

const terminal=new Set(["succeeded","blocked","failed","cancelled","dead_letter"]);
const failedStatuses=new Set(["blocked","failed","dead_letter"]);
const now=()=>new Date().toISOString();
const object=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;

function specialistWorkTypes(actionType:unknown){
  return actionType==="MAPS"||actionType==="LOCALIZE"
    ?(["technical.audit","research.discovery","strategy.roadmap","local.plan"] as const)
    :(["technical.audit","research.discovery","strategy.roadmap","content.plan"] as const);
}

async function releaseLease(db:SupabaseClient,enrollment:Enrollment,hours=enrollment.cycle_cadence_hours){
  await db.from("agent_service_enrollments").update({
    worker_id:null,locked_at:null,lock_expires_at:null,last_cycle_at:now(),
    next_cycle_at:new Date(Date.now()+hours*3_600_000).toISOString(),updated_at:now(),
  }).eq("id",enrollment.id);
}

async function escalate(db:SupabaseClient,enrollment:Enrollment,cycleId:string|null,type:string,title:string,summary:string,requiresClient=false){
  await db.from("agent_service_escalations").insert({
    enrollment_id:enrollment.id,cycle_id:cycleId,agency_id:enrollment.agency_id,
    client_organization_id:enrollment.client_organization_id,project_id:enrollment.project_id,
    escalation_type:type,title,summary,risk_level:type==="billing"?"high":"medium",requires_client:requiresClient,
    metadata:{source:"agent_service_outcome_loop"},
  });
}

async function accountableUser(db:SupabaseClient,enrollment:Enrollment,requestedBy?:string|null){
  if(requestedBy)return requestedBy;
  if(enrollment.created_by)return enrollment.created_by;
  const agency=await db.from("agency_members").select("user_id").eq("agency_id",enrollment.agency_id).eq("status","active").in("role",["agency_owner","agency_admin","seo_director"]).limit(1).maybeSingle();
  if(agency.data?.user_id)return String(agency.data.user_id);
  const client=await db.from("client_members").select("user_id").eq("agency_id",enrollment.agency_id).eq("client_organization_id",enrollment.client_organization_id).eq("status","active").in("role",["client_admin","client_approver"]).limit(1).maybeSingle();
  if(client.data?.user_id)return String(client.data.user_id);
  throw new ApiError("Managed SEO needs an accountable agency or client owner before work can start.",409,"ROLE_FORBIDDEN");
}

function expectedValue(evidence:unknown){
  const root=object(evidence),business=object(root.businessValue);
  return number(business.expectedMonthlyProfit??root.estimated_monthly_value)||null;
}

function campaignStep(campaign:Campaign):{runStatus:string;cycleStatus:string;step:OutcomeStepKey;stepStatus:string}{
  if(campaign.status==="awaiting_creative_evidence")return{runStatus:"awaiting_approval",cycleStatus:"awaiting_approval",step:"content",stepStatus:"waiting"};
  if(campaign.status==="awaiting_opportunity_review"||campaign.status==="awaiting_human_approval"||campaign.status==="awaiting_creative_review")return{runStatus:"awaiting_approval",cycleStatus:"awaiting_approval",step:"approval",stepStatus:"awaiting_approval"};
  if(campaign.status==="awaiting_preview_validation"||campaign.current_stage==="create_pr")return{runStatus:"preview",cycleStatus:"running",step:"preview",stepStatus:"running"};
  if(campaign.status==="awaiting_manual_completion")return{runStatus:"implementing",cycleStatus:"awaiting_approval",step:"implementation",stepStatus:"waiting"};
  if(campaign.status==="awaiting_deployment")return{runStatus:"publishing",cycleStatus:"monitoring",step:"publish",stepStatus:"waiting"};
  if(campaign.current_stage==="schedule_monitoring")return{runStatus:"monitoring",cycleStatus:"monitoring",step:"monitor",stepStatus:"running"};
  return{runStatus:"implementing",cycleStatus:"running",step:"implementation",stepStatus:"running"};
}

async function recordCampaignState(db:SupabaseClient,cycle:Cycle,run:Run,campaign:Campaign){
  const state=campaignStep(campaign);
  await Promise.all([
    db.from("outcome_loop_runs").update({status:state.runStatus,current_step:state.step,campaign_job_id:campaign.id,updated_at:now()}).eq("id",run.id),
    db.from("agent_service_cycles").update({status:state.cycleStatus,stage:state.step,campaign_job_id:campaign.id,updated_at:now()}).eq("id",cycle.id),
    setOutcomeStep(db,{runId:run.id,stepKey:state.step,status:state.stepStatus,output:{campaignJobId:campaign.id,campaignStatus:campaign.status}}),
  ]);
}

async function enqueueReport(db:SupabaseClient,enrollment:Enrollment,runId:string,requestedBy:string){
  const result=await enqueueAgentWorkItem(db,{agencyId:enrollment.agency_id,clientId:enrollment.client_organization_id,projectId:enrollment.project_id,userId:requestedBy},{
    workType:"reporting.summary",spendingLimit:0,idempotencyKey:`outcome:${runId}:reporting.summary`,
    sourceType:"outcome_loop",sourceId:runId,approvalOwner:enrollment.approval_owner,
    allowedTools:enrollment.allowed_tools,riskCeiling:enrollment.risk_ceiling,
    externalSpendRequiresApproval:enrollment.external_spend_requires_approval,
    evidence:{outcomeRunId:runId},proposedPlan:{serviceMode:"managed_agent",billable:false,reason:"Reporting is included in the completed outcome."},
  });
  await setOutcomeStep(db,{runId,stepKey:"report",status:"queued",workItemId:result.workItemId});
  return result.workItemId;
}

async function verifiedDelivery(db:SupabaseClient,campaign:Campaign,runId:string){
  const executionId=typeof campaign.result?.executionId==="string"?campaign.result.executionId:null;
  if(executionId){
    const [execution,monitoring]=await Promise.all([
      db.from("seo_executions").select("id,pull_request_url,production_commit_sha,production_deployed_at,status").eq("id",executionId).maybeSingle(),
      db.from("seo_monitoring_plans").select("id,status").eq("execution_id",executionId).maybeSingle(),
    ]);
    if(!execution.data?.production_deployed_at||!monitoring.data)return null;
    await Promise.all([
      db.from("seo_executions").update({outcome_run_id:runId}).eq("id",executionId),
      db.from("seo_monitoring_plans").update({outcome_run_id:runId}).eq("id",monitoring.data.id),
      db.from("outcome_loop_runs").update({execution_id:executionId,monitoring_plan_id:monitoring.data.id,updated_at:now()}).eq("id",runId),
    ]);
    return{kind:"repository_release" as const,proof:{campaignJobId:campaign.id,executionId,pullRequestUrl:execution.data.pull_request_url,productionCommitSha:execution.data.production_commit_sha,productionDeployedAt:execution.data.production_deployed_at,monitoringPlanId:monitoring.data.id}};
  }
  const packageId=typeof campaign.result?.packageId==="string"?campaign.result.packageId:null;
  if(!packageId)return null;
  const [verification,monitoring,publication]=await Promise.all([
    db.from("implementation_verifications").select("id,status,verified_at,live_url,proof").eq("package_id",packageId).eq("status","passed").maybeSingle(),
    db.from("seo_monitoring_plans").select("id,status").eq("implementation_package_id",packageId).maybeSingle(),
    db.from("cms_publications").select("id,provider,status,published_at,target_url").eq("package_id",packageId).eq("status","published").order("published_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(!verification.data||!monitoring.data)return null;
  await Promise.all([
    db.from("seo_monitoring_plans").update({outcome_run_id:runId}).eq("id",monitoring.data.id),
    db.from("outcome_loop_runs").update({implementation_package_id:packageId,monitoring_plan_id:monitoring.data.id,updated_at:now()}).eq("id",runId),
  ]);
  return{kind:publication.data?"cms_publication" as const:"verified_manual_implementation" as const,proof:{campaignJobId:campaign.id,packageId,verificationId:verification.data.id,verifiedAt:verification.data.verified_at,liveUrl:verification.data.live_url,publicationId:publication.data?.id??null,provider:publication.data?.provider??null,monitoringPlanId:monitoring.data.id}};
}

async function completeCampaignOutcome(db:SupabaseClient,enrollment:Enrollment,cycle:Cycle,run:Run,campaign:Campaign,requestedBy:string){
  const delivery=await verifiedDelivery(db,campaign,run.id);
  if(!delivery){
    await recordCampaignState(db,cycle,run,{...campaign,status:"awaiting_deployment",current_stage:"schedule_monitoring"});
    await releaseLease(db,enrollment,1);
    return true;
  }
  await setOutcomeStep(db,{runId:run.id,stepKey:"monitor",status:"succeeded",monitoringPlanId:String(delivery.proof.monitoringPlanId),output:delivery.proof});
  await commitOutcome(db,{runId:run.id,deliveryKind:delivery.kind,proof:delivery.proof});
  await enqueueReport(db,enrollment,run.id,requestedBy).catch(async error=>{
    await escalate(db,enrollment,cycle.id,"worker","Outcome delivered; report needs attention",error instanceof Error?error.message:"The included report could not be queued.");
  });
  await releaseLease(db,enrollment);
  return true;
}

async function ensureDirectCmsExecution(db:SupabaseClient,enrollment:Enrollment,cycle:Cycle,run:Run,campaign:Campaign,requestedBy:string){
  const packageId=typeof campaign.result?.packageId==="string"?campaign.result.packageId:null;
  if(!packageId)return false;
  const pkg=await db.from("implementation_packages").select("id,status").eq("id",packageId).eq("project_id",enrollment.project_id).maybeSingle();
  if(pkg.error)throw new ApiError("The exact approved implementation package could not be inspected.",503,"DATABASE_BINDING_FAILED");
  if(!pkg.data)return false;
  if(["rejected","revision_requested"].includes(pkg.data.status)){
    await releaseOutcome(db,{runId:run.id,reason:"The proposed implementation was rejected before delivery.",status:"cancelled"});
    await releaseLease(db,enrollment);
    return true;
  }
  const verified=await db.from("implementation_verifications").select("id,status").eq("package_id",packageId).eq("status","passed").maybeSingle();
  if(verified.error)throw new ApiError("The independent implementation verification could not be inspected.",503,"DATABASE_BINDING_FAILED");
  if(verified.data){
    await db.from("seo_campaign_jobs").update({status:"completed",progress_percent:100,completed_at:now(),updated_at:now()}).eq("id",campaign.id);
    return completeCampaignOutcome(db,enrollment,cycle,run,{...campaign,status:"completed"},requestedBy);
  }
  if(pkg.data.status!=="client_approved"&&pkg.data.status!=="implemented_unverified")return false;
  const connection=await db.from("cms_connections").select("id,cms_type").eq("agency_id",enrollment.agency_id).eq("project_id",enrollment.project_id).eq("status","active").in("cms_type",["wordpress","shopify","webflow"]).limit(1).maybeSingle();
  if(!connection.data)return false;
  const existing=await db.from("agent_work_items").select("id,work_type,status").eq("source_type","outcome_loop_delivery").eq("source_id",run.id).order("created_at");
  if(existing.data?.length){
    const stopped=existing.data.filter(item=>["blocked","failed","dead_letter","cancelled"].includes(item.status));
    if(stopped.length){
      await releaseOutcome(db,{runId:run.id,reason:`${stopped.length} protected delivery task${stopped.length===1?"":"s"} stopped before independent verification. No outcome was charged.`,status:stopped.some(item=>item.status==="cancelled")?"cancelled":"failed"});
      await escalate(db,enrollment,cycle.id,"worker","Approved CMS work did not pass delivery QA","The reserved outcome was returned because publishing or independent QA stopped before verified delivery.");
      await releaseLease(db,enrollment);
      return true;
    }
    await recordCampaignState(db,cycle,run,campaign);
    await releaseLease(db,enrollment,1);
    return true;
  }
  const workIds:string[]=[];
  for(const [index,workType] of (["implementation.change","qa.validate"] as const).entries()){
    const queued=await enqueueAgentWorkItem(db,{agencyId:enrollment.agency_id,clientId:enrollment.client_organization_id,projectId:enrollment.project_id,userId:requestedBy},{
      workType,spendingLimit:0,priority:95-index*5,idempotencyKey:`outcome:${run.id}:${workType}`,
      sourceType:"outcome_loop_delivery",sourceId:run.id,approvalOwner:enrollment.approval_owner,
      allowedTools:enrollment.allowed_tools,riskCeiling:enrollment.risk_ceiling,
      externalSpendRequiresApproval:enrollment.external_spend_requires_approval,
      evidence:{outcomeRunId:run.id,packageId,implementationProvider:connection.data.cms_type},
      proposedPlan:{serviceMode:"managed_agent",billable:false,exactPackageApproved:true},
    });
    workIds.push(queued.workItemId);
  }
  await Promise.all([
    db.from("agent_service_cycles").update({work_item_ids:[...new Set([...(cycle.work_item_ids??[]),...workIds])],implementation_package_id:packageId,status:"running",stage:"implementation",updated_at:now()}).eq("id",cycle.id),
    db.from("outcome_loop_runs").update({implementation_package_id:packageId,status:"implementing",current_step:"implementation",updated_at:now()}).eq("id",run.id),
    setOutcomeStep(db,{runId:run.id,stepKey:"implementation",status:"queued",workItemId:workIds[0],output:{packageId,provider:connection.data.cms_type}}),
    setOutcomeStep(db,{runId:run.id,stepKey:"qa",status:"queued",workItemId:workIds[1]}),
  ]);
  await releaseLease(db,enrollment,1);
  return true;
}

async function createCampaignHandoff(db:SupabaseClient,enrollment:Enrollment,cycle:Cycle,run:Run,requestedBy:string){
  const active=await db.from("seo_campaign_jobs").select("id,status,outcome_run_id").eq("project_id",enrollment.project_id).not("status","in","(completed,failed,cancelled,stale)").order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(active.data&&active.data.outcome_run_id!==run.id){
    await releaseOutcome(db,{runId:run.id,reason:"Another protected client workflow is already active. Capacity was returned.",status:"blocked"});
    await escalate(db,enrollment,cycle.id,"worker","Managed outcome is waiting behind active work","Another protected campaign is already active for this website. No action was charged.");
    await releaseLease(db,enrollment,1);
    return true;
  }
  const campaign=active.data??(await db.from("seo_campaign_jobs").insert({
    agency_id:enrollment.agency_id,client_organization_id:enrollment.client_organization_id,project_id:enrollment.project_id,
    campaign_id:null,requested_by:requestedBy,status:"queued",current_stage:"prepare",progress_percent:55,
    input:{automationMode:"EXECUTE_WITH_APPROVAL",managedOutcome:true,outcomeRunId:run.id},
    result:{opportunityId:cycle.selected_opportunity_id,outcomeRunId:run.id},
    idempotency_key:`outcome:${run.id}:campaign`,reference_id:crypto.randomUUID(),outcome_run_id:run.id,
  }).select("id,status,outcome_run_id").single()).data;
  if(!campaign?.id)throw new ApiError("The protected implementation workflow could not be created.",503,"DATABASE_BINDING_FAILED");
  await Promise.all([
    db.from("outcome_loop_runs").update({campaign_job_id:campaign.id,status:"awaiting_approval",current_step:"approval",updated_at:now()}).eq("id",run.id),
    db.from("agent_service_cycles").update({campaign_job_id:campaign.id,status:"awaiting_approval",stage:"approval",updated_at:now()}).eq("id",cycle.id),
    setOutcomeStep(db,{runId:run.id,stepKey:"approval",status:"queued",output:{campaignJobId:campaign.id}}),
  ]);
  await releaseLease(db,enrollment,1);
  return true;
}

async function reconcileActiveCycle(db:SupabaseClient,enrollment:Enrollment,requestedBy?:string|null){
  const result=await db.from("agent_service_cycles").select("*").eq("enrollment_id",enrollment.id).in("status",["queued","running","awaiting_approval","monitoring"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(!result.data)return false;
  const cycle=result.data as Cycle;
  if(!cycle.outcome_run_id){await releaseLease(db,enrollment,1);return true;}
  const runResult=await db.from("outcome_loop_runs").select("id,status,campaign_job_id").eq("id",cycle.outcome_run_id).maybeSingle();
  if(!runResult.data){await releaseLease(db,enrollment,1);return true;}
  const run=runResult.data as Run,userId=await accountableUser(db,enrollment,requestedBy);
  const campaignId=cycle.campaign_job_id??run.campaign_job_id;
  if(campaignId){
    const campaignResult=await db.from("seo_campaign_jobs").select("id,status,current_stage,result,error_code,error_message").eq("id",campaignId).maybeSingle();
    if(!campaignResult.data){await releaseOutcome(db,{runId:run.id,reason:"The protected campaign record is unavailable.",status:"failed"});await releaseLease(db,enrollment);return true;}
    const campaign=campaignResult.data as Campaign;
    if(campaign.status==="completed")return completeCampaignOutcome(db,enrollment,cycle,run,campaign,userId);
    if(["failed","cancelled","stale"].includes(campaign.status)){
      await releaseOutcome(db,{runId:run.id,reason:campaign.error_message??`The campaign ended as ${campaign.status} before delivery.`,status:campaign.status==="cancelled"?"cancelled":"failed"});
      await escalate(db,enrollment,cycle.id,"worker","Managed SEO outcome did not ship",campaign.error_message??"The protected workflow stopped before delivery; the reserved action was returned.");
      await releaseLease(db,enrollment);return true;
    }
    if(campaign.status==="awaiting_manual_completion"&&await ensureDirectCmsExecution(db,enrollment,cycle,run,campaign,userId))return true;
    await recordCampaignState(db,cycle,run,campaign);await releaseLease(db,enrollment,1);return true;
  }
  const ids=cycle.work_item_ids??[],[listed,linked,selectedOpportunity]=await Promise.all([
    ids.length?db.from("agent_work_items").select("id,work_type,status,final_outcome").in("id",ids):Promise.resolve({data:[]}),
    db.from("agent_work_items").select("id,work_type,status,final_outcome").eq("agency_id",enrollment.agency_id).eq("project_id",enrollment.project_id).eq("source_type","outcome_loop").eq("source_id",run.id),
    cycle.selected_opportunity_id?db.from("seo_opportunities").select("action_type").eq("id",cycle.selected_opportunity_id).eq("agency_id",enrollment.agency_id).eq("client_organization_id",enrollment.client_organization_id).eq("project_id",enrollment.project_id).maybeSingle():Promise.resolve({data:null}),
  ]),itemMap=new Map<string,Work>();
  for(const item of [...(listed.data??[]),...(linked.data??[])] as Work[])itemMap.set(item.id,item);
  const items=[...itemMap.values()];
  const active=items.filter(item=>!terminal.has(item.status));
  for(const item of items){
    const step=(item.work_type==="research.discovery"?"research":item.work_type==="strategy.roadmap"?"strategy":item.work_type==="content.plan"||item.work_type==="local.plan"?"content":item.work_type==="technical.audit"?"evidence":null) as OutcomeStepKey|null;
    if(step)await setOutcomeStep(db,{runId:run.id,stepKey:step,status:item.status==="succeeded"?"succeeded":item.status==="awaiting_approval"?"awaiting_approval":terminal.has(item.status)?"failed":"running",workItemId:item.id,output:item.final_outcome??{}});
  }
  if(active.length){
    const awaiting=active.some(item=>item.status==="awaiting_approval");
    await Promise.all([db.from("agent_service_cycles").update({status:awaiting?"awaiting_approval":"running",stage:awaiting?"approval":"analysis",updated_at:now()}).eq("id",cycle.id),db.from("outcome_loop_runs").update({status:awaiting?"awaiting_approval":"analyzing",current_step:awaiting?"approval":"research",updated_at:now()}).eq("id",run.id)]);
    await releaseLease(db,enrollment,1);return true;
  }
  const failed=items.filter(item=>failedStatuses.has(item.status)),cancelled=items.some(item=>item.status==="cancelled");
  if(failed.length||cancelled){
    await releaseOutcome(db,{runId:run.id,reason:cancelled?"Managed analysis was cancelled before delivery.":`${failed.length} specialist task${failed.length===1?"":"s"} failed before an outcome was prepared.`,status:cancelled?"cancelled":"failed"});
    if(failed.length)await escalate(db,enrollment,cycle.id,"worker","Managed SEO research needs attention","No action was charged because the specialist work did not produce a deliverable.");
    await releaseLease(db,enrollment);return true;
  }
  const required=specialistWorkTypes(selectedOpportunity.data?.action_type),present=new Set(items.map(item=>item.work_type)),missing=required.filter(workType=>!present.has(workType));
  if(missing.length){
    await releaseOutcome(db,{runId:run.id,reason:`The protected analysis handoff was incomplete (${missing.join(", ")}); capacity was returned before any implementation.`,status:"failed"});
    await escalate(db,enrollment,cycle.id,"worker","Managed SEO analysis handoff was incomplete","No action was charged because every required specialist assignment was not durably created.");
    await releaseLease(db,enrollment);return true;
  }
  if(items.length)return createCampaignHandoff(db,enrollment,cycle,run,userId);
  await releaseOutcome(db,{runId:run.id,reason:"No specialist work was created; the reserved action was returned.",status:"failed"});
  await releaseLease(db,enrollment);return true;
}

async function ensureDiscoveryCampaign(db:SupabaseClient,enrollment:Enrollment,requestedBy:string){
  const active=await db.from("seo_campaign_jobs").select("id,status").eq("project_id",enrollment.project_id).not("status","in","(completed,failed,cancelled,stale)").limit(1).maybeSingle();
  if(active.data)return active.data.id as string;
  const [project,locations]=await Promise.all([
    db.from("seo_projects").select("primary_market").eq("id",enrollment.project_id).maybeSingle(),
    db.from("seo_locations").select("name").eq("project_id",enrollment.project_id).eq("status","active").order("priority",{ascending:false}).limit(25),
  ]);
  const serviceAreas=(locations.data??[]).map(row=>row.name),targetMarket=project.data?.primary_market||serviceAreas.join(", ")||"verified service area";
  const inserted=await db.from("seo_campaign_jobs").insert({
    agency_id:enrollment.agency_id,client_organization_id:enrollment.client_organization_id,project_id:enrollment.project_id,
    requested_by:requestedBy,status:"queued",current_stage:"discover",progress_percent:0,
    input:{automationMode:"RECOMMEND",managedDiscoveryOnly:true,targetMarket,serviceAreas,discoveryLimit:100},
    result:{managedDiscoveryOnly:true},idempotency_key:`managed-discovery:${enrollment.project_id}:${new Date().toISOString().slice(0,10)}`,
    reference_id:crypto.randomUUID(),
  }).select("id").single();
  if(inserted.error&&inserted.error.code!=="23505")throw new ApiError("Evidence discovery could not be queued.",503,"DATABASE_BINDING_FAILED");
  return inserted.data?.id as string|undefined;
}

async function beginCycle(db:SupabaseClient,enrollment:Enrollment,input:{triggerType?:"scheduled"|"manual"|"onboarding"|"recovery";requestedBy?:string|null}={}){
  const upgradedTools=upgradeLegacyManagedTools(enrollment.allowed_tools??[]);
  if(upgradedTools.length!==(enrollment.allowed_tools??[]).length){
    const upgraded=await db.from("agent_service_enrollments").update({allowed_tools:upgradedTools,updated_at:now()}).eq("id",enrollment.id).select("id").maybeSingle();
    if(upgraded.error||!upgraded.data)throw new ApiError("The managed agent tool policy could not be upgraded safely.",503,"DATABASE_BINDING_FAILED");
    enrollment.allowed_tools=upgradedTools;
  }
  await resumeEvidenceBlockedAgentWork(db,{agencyId:enrollment.agency_id,projectId:enrollment.project_id,recoveryKey:`managed-cycle:${new Date().toISOString().slice(0,13)}`,allowedTools:enrollment.allowed_tools});
  if(await reconcileActiveCycle(db,enrollment,input.requestedBy))return{enrollmentId:enrollment.id,status:"reconciled"};
  const subscription=await db.from("client_subscriptions").select("status").eq("project_id",enrollment.project_id).maybeSingle();
  if(subscription.data&&!['active','trialing'].includes(subscription.data.status)){
    await db.from("agent_service_enrollments").update({status:subscription.data.status==="past_due"?"past_due":"paused",pause_reason:"Billing is not active",worker_id:null,locked_at:null,lock_expires_at:null,updated_at:now()}).eq("id",enrollment.id);
    await escalate(db,enrollment,null,"billing","Managed SEO is paused","Billing must be active before the next agent cycle can run.",true);return{enrollmentId:enrollment.id,status:"billing_blocked"};
  }
  const userId=await accountableUser(db,enrollment,input.requestedBy);
  const opportunity=await db.from("seo_opportunities").select("id,opportunity_score,confidence_score,action_type,target_milestone,evidence,recommended_actions,status").eq("agency_id",enrollment.agency_id).eq("client_organization_id",enrollment.client_organization_id).eq("project_id",enrollment.project_id).in("status",["open","selected","approved"]).gte("opportunity_score",55).order("opportunity_score",{ascending:false}).order("confidence_score",{ascending:false}).limit(1).maybeSingle();
  const cycleKey=`${new Date().toISOString().slice(0,13)}:${opportunity.data?.id??"evidence"}`;
  const priorCycle=await db.from("agent_service_cycles").select("*").eq("enrollment_id",enrollment.id).eq("cycle_key",cycleKey).maybeSingle();
  if(priorCycle.error)throw new ApiError("The managed-service cycle could not be inspected safely.",503,"DATABASE_BINDING_FAILED");
  const resumeCapacityBlock=priorCycle.data?.status==="blocked"&&priorCycle.data?.failure_code==="CHECKOUT_REQUIRED";
  if(priorCycle.data&&!resumeCapacityBlock){
    await releaseLease(db,enrollment,1);
    return{enrollmentId:enrollment.id,cycleId:priorCycle.data.id,status:["queued","running","awaiting_approval","monitoring"].includes(priorCycle.data.status)?"already_running":"already_processed"};
  }
  const cyclePayload={
    enrollment_id:enrollment.id,agency_id:enrollment.agency_id,client_organization_id:enrollment.client_organization_id,
    client_id:enrollment.client_id,project_id:enrollment.project_id,cycle_key:cycleKey,status:opportunity.data?"running":"no_action",
    stage:opportunity.data?"capacity":"evidence",selected_opportunity_id:opportunity.data?.id??null,
    evidence_summary:opportunity.data??{reason:"No qualified opportunity exists yet; evidence discovery was queued without using outcome capacity."},
    expected_value:expectedValue(opportunity.data?.evidence),started_at:now(),completed_at:opportunity.data?null:now(),
    recommendation:opportunity.data?null:"NO_ACTION",updated_at:now(),
  };
  const cycleResult=priorCycle.data
    ?{data:priorCycle.data,error:null}
    :await db.from("agent_service_cycles").insert(cyclePayload).select("*").single();
  if(cycleResult.error?.code==="23505"){
    const concurrent=await db.from("agent_service_cycles").select("id,status").eq("enrollment_id",enrollment.id).eq("cycle_key",cycleKey).maybeSingle();
    await releaseLease(db,enrollment,1);
    return{enrollmentId:enrollment.id,cycleId:concurrent.data?.id,status:"already_running"};
  }
  if(cycleResult.error||!cycleResult.data)throw new ApiError("The managed-service cycle could not be created. Apply migration 0026.",503,"DATABASE_BINDING_FAILED");
  if(!opportunity.data){
    const discoveryJobId=await ensureDiscoveryCampaign(db,enrollment,userId);
    await db.from("agent_service_cycles").update({outcome_summary:{discoveryJobId,billable:false,reason:"Evidence collection is included and did not consume an outcome action."}}).eq("id",cycleResult.data.id);
    await releaseLease(db,enrollment,1);return{enrollmentId:enrollment.id,cycleId:cycleResult.data.id,status:"evidence_queued",discoveryJobId};
  }
  const cycle=cycleResult.data as Cycle,runKey=`cycle:${cycle.id}`;
  const reservation=await reserveOutcome(db,{enrollmentId:enrollment.id,cycleId:cycle.id,opportunityId:opportunity.data.id,requestedBy:userId,runKey,triggerType:input.triggerType??"scheduled",expectedValue:expectedValue(opportunity.data.evidence),planSnapshot:{planDefinition:"one verified customer-visible outcome",opportunityScore:opportunity.data.opportunity_score,confidenceScore:opportunity.data.confidence_score,actionType:opportunity.data.action_type,internalStepsIncluded:true}});
  if(!reservation.allowed){
    const reason=reservation.reason??"CHECKOUT_REQUIRED";
    await escalate(db,enrollment,cycle.id,"capacity","Managed SEO capacity reached","The next evidence-backed outcome is ready. Buy a prepaid $15 outcome action or wait for the plan to renew; no work or charge was created.",enrollment.approval_owner!=="agency");
    await releaseLease(db,enrollment,24);return{enrollmentId:enrollment.id,cycleId:cycle.id,status:"capacity_blocked",reason};
  }
  const workTypes=specialistWorkTypes(opportunity.data.action_type);
  const workIds:string[]=[];
  for(const [index,workType] of workTypes.entries()){
    const queued=await enqueueAgentWorkItem(db,{agencyId:enrollment.agency_id,clientId:enrollment.client_organization_id,projectId:enrollment.project_id,userId},{
      workType,evidence:{outcomeRunId:reservation.runId,cycleId:cycle.id,opportunity:opportunity.data},
      proposedPlan:{serviceMode:"managed_agent",billable:false,noMakeWorkRule:true,customerCharge:"one outcome only after verified delivery"},
      spendingLimit:0,priority:95-index*5,idempotencyKey:`outcome:${reservation.runId}:${workType}`,
      sourceType:"outcome_loop",sourceId:reservation.runId,approvalOwner:enrollment.approval_owner,
      allowedTools:enrollment.allowed_tools,riskCeiling:enrollment.risk_ceiling,
      externalSpendRequiresApproval:enrollment.external_spend_requires_approval,
    });
    workIds.push(queued.workItemId);
    const step=(workType==="technical.audit"?"evidence":workType==="research.discovery"?"research":workType==="strategy.roadmap"?"strategy":"content") as OutcomeStepKey;
    await setOutcomeStep(db,{runId:reservation.runId,stepKey:step,status:"queued",workItemId:queued.workItemId});
  }
  await db.from("agent_service_cycles").update({outcome_run_id:reservation.runId,work_item_ids:workIds,stage:"analysis",updated_at:now()}).eq("id",cycle.id);
  await releaseLease(db,enrollment,1);return{enrollmentId:enrollment.id,cycleId:cycle.id,outcomeRunId:reservation.runId,status:"queued",workItems:workIds.length,capacitySource:reservation.capacitySource};
}

export async function runManagedAgentCycle(db:SupabaseClient,input:{agencyId:string;clientId:string;projectId:string;requestedBy:string}){
  const enrollment=await db.from("agent_service_enrollments").select("*").eq("agency_id",input.agencyId).eq("client_organization_id",input.clientId).eq("project_id",input.projectId).eq("service_mode","managed_agent").in("status",["trialing","active"]).maybeSingle();
  if(!enrollment.data)throw new ApiError("Choose an active Autopilot plan before starting the managed agent team.",402,"SUBSCRIPTION_REQUIRED");
  return beginCycle(db,enrollment.data as Enrollment,{triggerType:"manual",requestedBy:input.requestedBy});
}

export async function processAgentServiceBatch(size=10,workerId=`agent-service:${crypto.randomUUID()}`){
  const db=getLiveAdminClient(),claimed=await db.rpc("claim_due_agent_service_enrollments",{p_worker_id:workerId,p_batch_size:size,p_lock_seconds:300});
  if(claimed.error)throw new ApiError("Managed agent enrollments could not be claimed. Apply migration 0026.",503,"DATABASE_BINDING_FAILED");
  const enrollments=(claimed.data??[]) as Enrollment[],results=[];
  for(const enrollment of enrollments){
    try{results.push(await beginCycle(db,enrollment));}
    catch(error){
      const message=error instanceof Error?error.message:"Managed cycle failed";
      await db.from("agent_service_enrollments").update({worker_id:null,locked_at:null,lock_expires_at:null,next_cycle_at:new Date(Date.now()+3_600_000).toISOString(),updated_at:now()}).eq("id",enrollment.id);
      await escalate(db,enrollment,null,"worker","Managed SEO cycle failed",message);
      results.push({enrollmentId:enrollment.id,status:"failed"});
    }
  }
  return{claimed:enrollments.length,results};
}
