import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";
import {ApiError} from "@/lib/api/errors";
import {agentServicePlans,defaultManagedTools,isAgentServicePlanKey,planEntitlements,upgradeLegacyManagedTools,type AgentApprovalOwner,type AgentServiceMode} from "@/lib/agent-service/catalog";
import {buildGrowthRunway} from "@/lib/agent-service/growth-runway";
import {agencyBillingPlans,isAgencyBillingPlanKey} from "@/lib/billing/agency-catalog";
import {investmentPolicyForPlan} from "@/lib/seo/investment-policy";

export type AgentServiceTenant={agencyId:string;clientId:string;projectId:string;userId:string};
type EnrollmentInput={serviceMode:AgentServiceMode;planKey:string;approvalOwner:AgentApprovalOwner;operatorBrand:"hdseo"|"agency";billingOwner:"agency"|"client";allowedTools?:string[];resalePriceCents?:number};
type OutcomeDecision={kind:"opportunity"|"proof"|"creative"|"execution"|"release";id:string;outcomeRunId:string|null;title:string;summary:string;question:string;riskLevel:"low"|"medium"|"high";status:string;url:string|null;campaignJobId?:string;draft?:{title:unknown;metaDescription:unknown;h1:unknown;sections:unknown;faqs:unknown;qa:unknown};files?:Array<{id:string;path:string;reason:string|null;diff:string|null}>;validation?:Record<string,unknown>};

const now=()=>new Date().toISOString();
const asRecord=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

async function enterpriseClientId(db:SupabaseClient,tenant:Omit<AgentServiceTenant,"userId">){
  const result=await db.from("clients").select("id").eq("agency_id",tenant.agencyId).eq("organization_id",tenant.clientId).maybeSingle();
  if(result.error||!result.data)throw new ApiError("The enterprise client record is unavailable.",409,"DATABASE_BINDING_FAILED");
  return result.data.id as string;
}

async function enforcePaidEnrollment(db:SupabaseClient,tenant:AgentServiceTenant,input:EnrollmentInput,excludeProjectId?:string){
  if(input.billingOwner==="client"){
    const subscription=await db.from("client_subscriptions").select("plan_key,status").eq("project_id",tenant.projectId).maybeSingle();
    if(!subscription.data||!["trialing","active"].includes(subscription.data.status))throw new ApiError("Choose an active HD SEO plan before turning on Autopilot.",402,"SUBSCRIPTION_REQUIRED");
    if(subscription.data.plan_key!==input.planKey)throw new ApiError("This service level does not match the business subscription.",409,"PLAN_MISMATCH");
    const expectedMode=["pro","autopilot_plus"].includes(input.planKey)?"managed_agent":"copilot";
    if(input.serviceMode!==expectedMode)throw new ApiError(expectedMode==="managed_agent"?"Choose Autopilot or Autopilot Plus for managed agent execution.":"This plan includes Copilot controls, not managed agent execution.",409,"PLAN_MISMATCH");
    return;
  }
  if(!["agency_core","agency_scale"].includes(input.planKey))throw new ApiError("Agency subscriptions support Managed Core or Managed Scale client service.",400,"PLAN_MISMATCH");
  const subscription=await db.from("agency_subscriptions").select("plan_key,status,included_client_limit,included_scale_client_limit").eq("agency_id",tenant.agencyId).maybeSingle();
  if(!subscription.data||!["trialing","active"].includes(subscription.data.status)||!isAgencyBillingPlanKey(subscription.data.plan_key))throw new ApiError("Choose an active agency plan before enrolling managed clients.",402,"AGENCY_SUBSCRIPTION_REQUIRED");
  const rows=await db.from("agent_service_enrollments").select("project_id,plan_key").eq("agency_id",tenant.agencyId).eq("billing_owner","agency").in("status",["trialing","active"]);
  if(rows.error)throw new ApiError("Agency capacity could not be verified.",503,"DATABASE_BINDING_FAILED");
  const active=(rows.data??[]).filter(row=>row.project_id!==excludeProjectId);
  const entitlements=agencyBillingPlans[subscription.data.plan_key];
  const clientLimit=Math.min(Number(subscription.data.included_client_limit),entitlements.includedClients);
  const scaleLimit=Math.min(Number(subscription.data.included_scale_client_limit),entitlements.includedScaleClients);
  if(active.length>=clientLimit)throw new ApiError(`${entitlements.label} includes ${clientLimit} active managed clients. Upgrade before adding another.`,409,"AGENCY_CLIENT_LIMIT_REACHED");
  if(input.planKey==="agency_scale"&&active.filter(row=>row.plan_key==="agency_scale").length>=scaleLimit)throw new ApiError(`${entitlements.label} includes ${scaleLimit} Managed Scale client seat${scaleLimit===1?"":"s"}. Upgrade or move another client to Core.`,409,"AGENCY_SCALE_LIMIT_REACHED");
}

export async function enrollAgentService(db:SupabaseClient,tenant:AgentServiceTenant,input:EnrollmentInput){
  if(!isAgentServicePlanKey(input.planKey))throw new ApiError("This managed-service plan is not available.",400,"VALIDATION_ERROR");
  const existing=await db.from("agent_service_enrollments").select("id,status").eq("project_id",tenant.projectId).maybeSingle();
  await enforcePaidEnrollment(db,tenant,input,existing.data?tenant.projectId:undefined);
  const entitlements=agentServicePlans[input.planKey],clientId=await enterpriseClientId(db,tenant);
  const payload={agency_id:tenant.agencyId,client_organization_id:tenant.clientId,client_id:clientId,project_id:tenant.projectId,created_by:tenant.userId,
    service_mode:input.serviceMode,operator_brand:input.operatorBrand,approval_owner:input.approvalOwner,billing_owner:input.billingOwner,plan_key:input.planKey,
    status:existing.data?.status==="past_due"?"past_due":"active",monthly_action_limit:entitlements.monthlyActionLimit,
    monthly_major_page_limit:entitlements.monthlyMajorPageLimit,
    monthly_provider_budget:entitlements.monthlyProviderBudget,monthly_human_review_minutes:entitlements.humanReviewMinutes,
    cycle_cadence_hours:entitlements.cycleCadenceHours,next_cycle_at:now(),allowed_tools:input.allowedTools?.length?input.allowedTools:[...defaultManagedTools],
    resale_price_cents:Math.max(0,input.resalePriceCents??0),pause_reason:null,updated_at:now()};
  const result=await db.from("agent_service_enrollments").upsert(payload,{onConflict:"project_id"}).select("*").single();
  if(result.error)throw new ApiError("Agent service enrollment could not be saved. Apply migration 0026.",503,"DATABASE_BINDING_FAILED");
  await db.from("audit_logs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,actor_user_id:tenant.userId,action:existing.data?"agent_service.updated":"agent_service.enrolled",object_type:"agent_service_enrollment",object_id:result.data.id,after_summary:{serviceMode:input.serviceMode,planKey:input.planKey,approvalOwner:input.approvalOwner,operatorBrand:input.operatorBrand}});
  return result.data;
}

export async function setAgentServiceStatus(db:SupabaseClient,tenant:AgentServiceTenant,status:"active"|"paused",reason?:string){
  if(status==="active"){
    const current=await db.from("agent_service_enrollments").select("plan_key,service_mode,operator_brand,approval_owner,billing_owner").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle();
    if(!current.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
    await enforcePaidEnrollment(db,tenant,{planKey:current.data.plan_key,serviceMode:current.data.service_mode,operatorBrand:current.data.operator_brand,approvalOwner:current.data.approval_owner,billingOwner:current.data.billing_owner},tenant.projectId);
  }
  const result=await db.from("agent_service_enrollments").update({status,pause_reason:status==="paused"?(reason?.trim()||"Paused by an authorized user"):null,next_cycle_at:status==="active"?now():undefined,worker_id:null,locked_at:null,lock_expires_at:null,updated_at:now()}).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("*").maybeSingle();
  if(result.error||!result.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
  await db.from("audit_logs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,actor_user_id:tenant.userId,action:`agent_service.${status}`,object_type:"agent_service_enrollment",object_id:result.data.id,after_summary:{status,reason:reason??null}});
  return result.data;
}

export async function requestManagedAgentServiceCycle(db:SupabaseClient,tenant:AgentServiceTenant){
  const current=await db.from("agent_service_enrollments")
    .select("id,status,service_mode,allowed_tools")
    .eq("agency_id",tenant.agencyId)
    .eq("client_organization_id",tenant.clientId)
    .eq("project_id",tenant.projectId)
    .maybeSingle();
  if(current.error)throw new ApiError("Managed agent capacity could not be verified.",503,"DATABASE_BINDING_FAILED");
  if(!current.data)throw new ApiError("Choose an active Autopilot or agency managed-service plan before running the agent team.",402,"SUBSCRIPTION_REQUIRED");
  if(current.data.service_mode!=="managed_agent")throw new ApiError("This plan includes Copilot controls. Upgrade to an Autopilot or managed agency plan to run the full agent team.",409,"PLAN_MISMATCH");
  if(!["trialing","active"].includes(current.data.status))throw new ApiError("Managed agent service is paused or unavailable. Restore billing or resume the service before requesting another cycle.",409,"CONFLICT");

  const allowedTools=upgradeLegacyManagedTools(current.data.allowed_tools??[]),toolsUpdated=allowedTools.length!==(current.data.allowed_tools??[]).length;
  const update=await db.from("agent_service_enrollments").update({
    next_cycle_at:now(),
    ...(toolsUpdated?{allowed_tools:allowedTools}:{}),
    updated_at:now(),
  }).eq("id",current.data.id).eq("status",current.data.status).select("id").maybeSingle();
  if(update.error||!update.data)throw new ApiError("The managed agent cycle could not be queued safely.",503,"DATABASE_BINDING_FAILED");
  return{enrollmentId:current.data.id,allowedTools,toolsUpdated};
}

export async function changeAgentServicePlan(db:SupabaseClient,tenant:AgentServiceTenant,planKey:string){
  if(!isAgentServicePlanKey(planKey))throw new ApiError("This managed-service plan is not available.",400,"VALIDATION_ERROR");
  const current=await db.from("agent_service_enrollments").select("billing_owner,operator_brand,approval_owner,service_mode").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle();
  if(!current.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
  await enforcePaidEnrollment(db,tenant,{planKey,serviceMode:current.data.service_mode,operatorBrand:current.data.operator_brand,approvalOwner:current.data.approval_owner,billingOwner:current.data.billing_owner},tenant.projectId);
  const plan=planEntitlements(planKey),result=await db.from("agent_service_enrollments").update({plan_key:planKey,monthly_action_limit:plan.monthlyActionLimit,monthly_major_page_limit:plan.monthlyMajorPageLimit,monthly_provider_budget:plan.monthlyProviderBudget,monthly_human_review_minutes:plan.humanReviewMinutes,cycle_cadence_hours:plan.cycleCadenceHours,updated_at:now()}).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("*").maybeSingle();
  if(result.error||!result.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
  return result.data;
}

export async function updateAgentServiceSettings(db:SupabaseClient,tenant:AgentServiceTenant,input:{approvalOwner?:AgentApprovalOwner;operatorBrand?:"hdseo"|"agency";riskCeiling?:"low"|"medium"|"high";monthlyActionLimit?:number;monthlyProviderBudget?:number;allowedTools?:string[];resalePriceCents?:number;brandName?:string;supportEmail?:string}){
  const current=await db.from("agent_service_enrollments").select("plan_key").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle();
  if(!current.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
  const entitlement=planEntitlements(current.data.plan_key),update:Record<string,unknown>={updated_at:now()};
  if(input.approvalOwner)update.approval_owner=input.approvalOwner;
  if(input.operatorBrand)update.operator_brand=input.operatorBrand;
  if(input.riskCeiling)update.risk_ceiling=input.riskCeiling;
  if(input.monthlyActionLimit!=null)update.monthly_action_limit=Math.min(entitlement.monthlyActionLimit,Math.max(0,input.monthlyActionLimit));
  if(input.monthlyProviderBudget!=null)update.monthly_provider_budget=Math.min(entitlement.monthlyProviderBudget,Math.max(0,input.monthlyProviderBudget));
  if(input.allowedTools)update.allowed_tools=input.allowedTools;
  if(input.resalePriceCents!=null)update.resale_price_cents=Math.max(0,input.resalePriceCents);
  const result=await db.from("agent_service_enrollments").update(update).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("*").maybeSingle();
  if(result.error||!result.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
  if(input.operatorBrand||input.brandName||input.supportEmail||input.resalePriceCents!=null)await db.from("agency_resale_settings").upsert({agency_id:tenant.agencyId,enabled:input.operatorBrand==="agency",brand_name:input.brandName?.trim()||null,support_email:input.supportEmail?.trim()||null,suggested_resale_price_cents:Math.max(0,input.resalePriceCents??0),updated_at:now()},{onConflict:"agency_id"});
  await db.from("audit_logs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,actor_user_id:tenant.userId,action:"agent_service.settings_updated",object_type:"agent_service_enrollment",object_id:result.data.id,after_summary:{approvalOwner:input.approvalOwner,operatorBrand:input.operatorBrand,riskCeiling:input.riskCeiling,monthlyActionLimit:input.monthlyActionLimit,monthlyProviderBudget:input.monthlyProviderBudget,resalePriceCents:input.resalePriceCents}});
  return result.data;
}

export async function focusGrowthRunway(db:SupabaseClient,tenant:AgentServiceTenant,opportunityId:string){
  const [enrollment,project,opportunities]=await Promise.all([
    db.from("agent_service_enrollments").select("id,plan_key,status").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle(),
    db.from("seo_projects").select("market_scope").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("id",tenant.projectId).maybeSingle(),
    db.from("seo_opportunities").select("id,status,action_type,target_url,opportunity_score,confidence_score,reason_codes,evidence").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).in("status",["open","selected","approved"]).order("opportunity_score",{ascending:false}).limit(100),
  ]);
  if(enrollment.error||!enrollment.data||!["active","trialing"].includes(enrollment.data.status))throw new ApiError("Autopilot must be active before choosing a campaign focus.",409,"CONFLICT");
  if(project.error||!project.data||opportunities.error)throw new ApiError("The campaign runway could not be verified.",503,"DATABASE_BINDING_FAILED");
  const runway=buildGrowthRunway(opportunities.data??[],project.data.market_scope==="nationwide"?"nationwide":"service_area",investmentPolicyForPlan(String(enrollment.data.plan_key)));
  const selected=runway.find(item=>item.id===opportunityId);
  if(!selected)throw new ApiError("This opportunity is no longer available in the safe growth runway. Refresh and choose another.",409,"CONFLICT");
  const selectedRow=(opportunities.data??[]).find(item=>item.id===opportunityId);
  if(!selectedRow)throw new ApiError("This opportunity is no longer available.",409,"CONFLICT");

  for(const row of opportunities.data??[]){
    const evidence=asRecord(row.evidence),focus=asRecord(evidence.customerFocus);
    if(focus.active!==true||row.id===opportunityId)continue;
    const cleared=await db.from("seo_opportunities").update({evidence:{...evidence,customerFocus:{...focus,active:false,replacedAt:now(),replacedBy:opportunityId}},updated_at:now()}).eq("id",row.id).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("id").maybeSingle();
    if(cleared.error||!cleared.data)throw new ApiError("The previous campaign focus could not be replaced safely.",503,"DATABASE_BINDING_FAILED");
  }
  const selectedEvidence=asRecord(selectedRow.evidence),selectedAt=now();
  const saved=await db.from("seo_opportunities").update({
    evidence:{...selectedEvidence,customerFocus:{active:true,selectedAt,selectedBy:tenant.userId,targetUrl:selected.targetUrl,keywords:selected.keywords}},
    updated_at:selectedAt,
  }).eq("id",opportunityId).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("id").maybeSingle();
  if(saved.error||!saved.data)throw new ApiError("The campaign focus could not be saved.",503,"DATABASE_BINDING_FAILED");
  const queuedResearch=await db.from("seo_campaign_jobs").select("id,input").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("status","queued").contains("input",{managedDiscoveryOnly:true}).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(queuedResearch.error)throw new ApiError("The focused research queue could not be inspected.",503,"DATABASE_BINDING_FAILED");
  if(queuedResearch.data){
    const input=asRecord(queuedResearch.data.input);
    const focused=await db.from("seo_campaign_jobs").update({input:{...input,adaptiveReason:"customer_focused_runway",focusOpportunityId:opportunityId,focusTargetUrl:selected.targetUrl,focusKeywords:selected.keywords},updated_at:selectedAt}).eq("id",queuedResearch.data.id).eq("status","queued").select("id").maybeSingle();
    if(focused.error||!focused.data)throw new ApiError("The queued research pass could not be focused safely.",503,"DATABASE_BINDING_FAILED");
  }
  const scheduled=await db.from("agent_service_enrollments").update({next_cycle_at:selectedAt,worker_id:null,locked_at:null,lock_expires_at:null,updated_at:selectedAt}).eq("id",enrollment.data.id).in("status",["active","trialing"]).select("id").maybeSingle();
  if(scheduled.error||!scheduled.data)throw new ApiError("The focused research cycle could not be scheduled.",503,"DATABASE_BINDING_FAILED");
  await db.from("audit_logs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,actor_user_id:tenant.userId,action:"growth_runway.focus_selected",object_type:"seo_opportunity",object_id:opportunityId,after_summary:{targetUrl:selected.targetUrl,keywords:selected.keywords,valueCoveragePercent:selected.valueCoveragePercent}});
  return{...selected,selected:true,selectedAt};
}

export async function agentServiceSnapshot(db:SupabaseClient,tenant:Omit<AgentServiceTenant,"userId">){
  const enrollment=await db.from("agent_service_enrollments").select("*").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle();
  if(enrollment.error)throw new ApiError("The managed agent service database is not ready. Apply migration 0026.",503,"DATABASE_BINDING_FAILED");
  if(!enrollment.data)return{tenant,enrollment:null,cycles:[],usage:[],escalations:[],activeWork:[],approvals:[],outcomeDecisions:[],outcomeRuns:[],researchProgress:null,growthRunway:[],summary:null};
  const [cycles,usage,escalations,client,outcomeRuns,campaignDecisions,executionDecisions,releaseDecisions,researchJobs,projectPolicy,runwayOpportunities]=await Promise.all([
    db.from("agent_service_cycles").select("*").eq("enrollment_id",enrollment.data.id).order("created_at",{ascending:false}).limit(30),
    db.from("agent_service_usage").select("*").eq("enrollment_id",enrollment.data.id).gte("occurred_at",enrollment.data.current_period_start).order("occurred_at",{ascending:false}).limit(100),
    db.from("agent_service_escalations").select("*").eq("enrollment_id",enrollment.data.id).order("created_at",{ascending:false}).limit(50),
    db.from("clients").select("id").eq("agency_id",tenant.agencyId).eq("organization_id",tenant.clientId).single(),
    db.from("outcome_loop_runs").select("id,opportunity_id,status,current_step,expected_value,delivery_kind,delivered_at,campaign_job_id,execution_id,monitoring_plan_id,failure_code,failure_message,plan_snapshot,created_at,updated_at").eq("enrollment_id",enrollment.data.id).order("created_at",{ascending:false}).limit(30),
    db.from("seo_campaign_jobs").select("id,status,result,outcome_run_id,updated_at").eq("project_id",tenant.projectId).not("outcome_run_id","is",null).in("status",["awaiting_opportunity_review","awaiting_creative_evidence","awaiting_creative_review"]).order("updated_at",{ascending:false}).limit(20),
    db.from("seo_executions").select("id,status,outcome_run_id,updated_at").eq("project_id",tenant.projectId).not("outcome_run_id","is",null).eq("status","awaiting_review").order("updated_at",{ascending:false}).limit(20),
    db.from("seo_executions").select("id,status,pull_request_url,preview_url,preview_deployment_id,validation_results,outcome_run_id,updated_at").eq("project_id",tenant.projectId).not("outcome_run_id","is",null).eq("status","preview_ready").order("updated_at",{ascending:false}).limit(20),
    db.from("seo_campaign_jobs").select("id,status,current_stage,progress_percent,input,result,created_at,updated_at,completed_at").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).contains("input",{managedDiscoveryOnly:true}).order("created_at",{ascending:false}).limit(10),
    db.from("seo_projects").select("market_scope").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("id",tenant.projectId).maybeSingle(),
    db.from("seo_opportunities").select("id,status,action_type,target_url,opportunity_score,confidence_score,reason_codes,evidence").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).in("status",["open","selected","approved"]).order("opportunity_score",{ascending:false}).limit(100),
  ]);
  const [activeWork,approvals]=client.data?await Promise.all([
    db.from("agent_work_items").select("id,work_type,goal,assigned_agent_key,status,risk_level,spending_limit,spent_amount,final_outcome,updated_at").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).not("status","in","(succeeded,cancelled,failed,dead_letter)").order("priority",{ascending:false}).limit(30),
    db.from("agent_approvals").select("id,work_item_id,approval_type,title,summary,risk_level,status,requested_at").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).eq("status","awaiting").order("requested_at",{ascending:false}).limit(30),
  ]):[{data:[]},{data:[]}];
  const majorPagesUsed=(usage.data??[]).filter(item=>item.usage_type==="page_build").reduce((sum,item)=>sum+Number(item.quantity??0),0);
  const creativeDraftIds=(campaignDecisions.data??[]).flatMap(item=>{
    const result=item.result&&typeof item.result==="object"&&!Array.isArray(item.result)?item.result as Record<string,unknown>:{};
    return typeof result.creativeDraftId==="string"?[result.creativeDraftId]:[];
  });
  const creativeDrafts=creativeDraftIds.length?await db.from("seo_creative_drafts").select("id,title,meta_description,h1,summary,sections,faqs,qa_results,status").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).in("id",creativeDraftIds):{data:[]};
  const creativeById=new Map((creativeDrafts.data??[]).map(item=>[item.id,item]));
  const executionIds=(executionDecisions.data??[]).map(item=>item.id),executionFiles=executionIds.length?await db.from("seo_execution_files").select("id,execution_id,file_path,reason,diff").in("execution_id",executionIds).eq("status","proposed").order("file_path"):{data:[]};
  const filesByExecution=new Map<string,Array<{id:string;path:string;reason:string|null;diff:string|null}>>();
  for(const file of executionFiles.data??[]){const list=filesByExecution.get(file.execution_id)??[];list.push({id:file.id,path:file.file_path,reason:file.reason??null,diff:file.diff??null});filesByExecution.set(file.execution_id,list);}
  const decisions:OutcomeDecision[]=(campaignDecisions.data??[]).flatMap<OutcomeDecision>(item=>{
    const result=item.result&&typeof item.result==="object"&&!Array.isArray(item.result)?item.result as Record<string,unknown>:{};
    if(item.status==="awaiting_opportunity_review")return[{kind:"opportunity" as const,id:item.id,outcomeRunId:item.outcome_run_id,title:"Choose the next SEO investment",summary:String(result.plainSummary??"HD SEO found the strongest evidence-backed opportunity and is waiting before preparing the exact change."),question:String(result.approvalQuestion??"Should HD SEO prepare this change for a validated preview?"),riskLevel:"medium",status:item.status,url:null}];
    if(item.status==="awaiting_creative_evidence")return[{kind:"proof" as const,id:item.id,outcomeRunId:item.outcome_run_id,title:"Add proof before HD SEO writes",summary:String(result.requiredAction??"HD SEO needs two different verified business proof items so the page contains real, defensible claims."),question:"Add or verify business proof, then retry this outcome. No outcome has been charged.",riskLevel:"low",status:item.status,url:null}];
    const draftId=typeof result.creativeDraftId==="string"?result.creativeDraftId:null,draft=draftId?creativeById.get(draftId):null;
    if(!draftId||!draft)return[];
    return[{kind:"creative" as const,id:draftId,campaignJobId:item.id,outcomeRunId:item.outcome_run_id,title:"Review the exact page draft",summary:String(draft.summary??draft.title??"The generated draft passed deterministic evidence and quality checks."),question:"Approve this exact draft before HD SEO creates code or publishes anything?",riskLevel:"medium",status:item.status,url:null,draft:{title:draft.title,metaDescription:draft.meta_description,h1:draft.h1,sections:draft.sections,faqs:draft.faqs,qa:draft.qa_results}}];
  });
  decisions.push(...(executionDecisions.data??[]).flatMap<OutcomeDecision>(item=>{const files=filesByExecution.get(item.id)??[];if(!files.length)return[];return[{kind:"execution",id:item.id,outcomeRunId:item.outcome_run_id,title:"Review the exact website change",summary:`HD SEO prepared ${files.length} exact repository file change${files.length===1?"":"s"}. Review the filenames, reasons, and diff before HD SEO creates a protected pull request and preview.`,question:"Approve these exact file changes for a protected preview, or request a revision?",riskLevel:"high",status:item.status,url:null,files}];}));
  decisions.push(...(releaseDecisions.data??[]).filter(item=>!item.outcome_run_id).map<OutcomeDecision>(item=>{const validation=item.validation_results&&typeof item.validation_results==="object"&&!Array.isArray(item.validation_results)?item.validation_results as Record<string,unknown>:{};return{kind:"release",id:item.id,outcomeRunId:item.outcome_run_id,title:"Release the QA-passed preview",summary:"The exact approved change has a healthy preview. Releasing merges through protected GitHub rules; HD SEO then waits for production, validates it, and starts outcome monitoring.",question:"Release this validated preview to production?",riskLevel:"high",status:item.status,url:item.preview_url??item.pull_request_url??null,validation};}));
  const activeStatuses=["reserved","analyzing","awaiting_approval","implementing","preview","qa","publishing","monitoring"];
  const capacityRemaining=Math.max(0,enrollment.data.monthly_action_limit-enrollment.data.actions_used)+Number(enrollment.data.purchased_action_balance??0);
  const reservedCapacity=(outcomeRuns.data??[]).filter(item=>activeStatuses.includes(item.status)).reduce((sum,item)=>{
    const snapshot=item.plan_snapshot&&typeof item.plan_snapshot==="object"&&!Array.isArray(item.plan_snapshot)?item.plan_snapshot as Record<string,unknown>:{};
    return sum+Math.max(1,Number(snapshot.capacityUnits??1));
  },0);
  const latestResearch=researchJobs.data?.[0]??null,researchInput=latestResearch?.input&&typeof latestResearch.input==="object"&&!Array.isArray(latestResearch.input)?latestResearch.input as Record<string,unknown>:{};
  const latestResearchCandidates=latestResearch?await db.from("seo_campaign_candidates").select("score,confidence,eligibility_status").eq("job_id",latestResearch.id):{data:[],error:null};
  const candidateRows=latestResearchCandidates.data??[],today=new Date().toISOString().slice(0,10),attemptsToday=(researchJobs.data??[]).filter(item=>String(item.created_at).startsWith(today)).length;
  const adaptiveWave=Math.max(1,Number(researchInput.adaptiveWave??1)),maxAdaptiveWaves=Math.max(adaptiveWave,Number(researchInput.maxAdaptiveWaves??3));
  const researchProgress=latestResearch?{
    status:latestResearch.status,
    stage:latestResearch.current_stage,
    progressPercent:Number(latestResearch.progress_percent??0),
    adaptiveWave,
    maxAdaptiveWaves,
    attemptsToday,
    opportunitiesReviewed:candidateRows.length,
    qualifiedCount:candidateRows.filter(item=>["eligible","selected"].includes(item.eligibility_status)).length,
    strongestScore:candidateRows.length?Math.max(...candidateRows.map(item=>Number(item.score??0))):null,
    lastUpdatedAt:latestResearch.updated_at,
    completedAt:latestResearch.completed_at,
    nextCheckAt:enrollment.data.next_cycle_at,
  }:null;
  const growthRunway=buildGrowthRunway(
    runwayOpportunities.data??[],
    projectPolicy.data?.market_scope==="nationwide"?"nationwide":"service_area",
    investmentPolicyForPlan(String(enrollment.data.plan_key)),
  );
  return{tenant,enrollment:enrollment.data,cycles:cycles.data??[],usage:usage.data??[],escalations:escalations.data??[],activeWork:activeWork.data??[],approvals:approvals.data??[],outcomeDecisions:decisions,outcomeRuns:outcomeRuns.data??[],researchProgress,growthRunway,summary:{capacityRemaining,capacityLimit:Number(enrollment.data.monthly_action_limit),capacityUsed:Number(enrollment.data.actions_used),reservedCapacity,actionsRemaining:capacityRemaining,reservedActions:reservedCapacity,completedOutcomes:(outcomeRuns.data??[]).filter(item=>item.status==="completed").length,majorPagesRemaining:Math.max(0,Number(enrollment.data.monthly_major_page_limit??0)-majorPagesUsed),providerBudgetRemaining:Math.max(0,Number(enrollment.data.monthly_provider_budget)-Number(enrollment.data.provider_spend_used))+Number(enrollment.data.purchased_provider_balance??0),openEscalations:(escalations.data??[]).filter(item=>["open","in_progress","waiting"].includes(item.status)).length,nextCycleAt:enrollment.data.next_cycle_at}};
}

export async function resolveAgentServiceEscalation(db:SupabaseClient,tenant:AgentServiceTenant,id:string,resolution:string){
  const result=await db.from("agent_service_escalations").update({status:"resolved",resolution:resolution.trim(),resolved_by:tenant.userId,resolved_at:now(),updated_at:now()}).eq("id",id).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("status","open").select("id").maybeSingle();
  if(result.error||!result.data)throw new ApiError("This escalation is not open or does not belong to this project.",404,"NOT_FOUND");
}
