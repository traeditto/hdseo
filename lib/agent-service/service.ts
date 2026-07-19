import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";
import {ApiError} from "@/lib/api/errors";
import {agentServicePlans,defaultManagedTools,isAgentServicePlanKey,planEntitlements,type AgentApprovalOwner,type AgentServiceMode} from "@/lib/agent-service/catalog";

export type AgentServiceTenant={agencyId:string;clientId:string;projectId:string;userId:string};
type EnrollmentInput={serviceMode:AgentServiceMode;planKey:string;approvalOwner:AgentApprovalOwner;operatorBrand:"hdseo"|"agency";billingOwner:"agency"|"client";allowedTools?:string[];resalePriceCents?:number};

const now=()=>new Date().toISOString();

async function enterpriseClientId(db:SupabaseClient,tenant:Omit<AgentServiceTenant,"userId">){
  const result=await db.from("clients").select("id").eq("agency_id",tenant.agencyId).eq("organization_id",tenant.clientId).maybeSingle();
  if(result.error||!result.data)throw new ApiError("The enterprise client record is unavailable.",409,"DATABASE_BINDING_FAILED");
  return result.data.id as string;
}

export async function enrollAgentService(db:SupabaseClient,tenant:AgentServiceTenant,input:EnrollmentInput){
  if(!isAgentServicePlanKey(input.planKey))throw new ApiError("This managed-service plan is not available.",400,"VALIDATION_ERROR");
  const entitlements=agentServicePlans[input.planKey],clientId=await enterpriseClientId(db,tenant);
  const existing=await db.from("agent_service_enrollments").select("id,status").eq("project_id",tenant.projectId).maybeSingle();
  const payload={agency_id:tenant.agencyId,client_organization_id:tenant.clientId,client_id:clientId,project_id:tenant.projectId,created_by:tenant.userId,
    service_mode:input.serviceMode,operator_brand:input.operatorBrand,approval_owner:input.approvalOwner,billing_owner:input.billingOwner,plan_key:input.planKey,
    status:existing.data?.status==="past_due"?"past_due":"active",monthly_action_limit:entitlements.monthlyActionLimit,
    monthly_provider_budget:entitlements.monthlyProviderBudget,monthly_human_review_minutes:entitlements.humanReviewMinutes,
    cycle_cadence_hours:entitlements.cycleCadenceHours,next_cycle_at:now(),allowed_tools:input.allowedTools?.length?input.allowedTools:[...defaultManagedTools],
    resale_price_cents:Math.max(0,input.resalePriceCents??0),pause_reason:null,updated_at:now()};
  const result=await db.from("agent_service_enrollments").upsert(payload,{onConflict:"project_id"}).select("*").single();
  if(result.error)throw new ApiError("Agent service enrollment could not be saved. Apply migration 0026.",503,"DATABASE_BINDING_FAILED");
  await db.from("audit_logs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,actor_user_id:tenant.userId,action:existing.data?"agent_service.updated":"agent_service.enrolled",object_type:"agent_service_enrollment",object_id:result.data.id,after_summary:{serviceMode:input.serviceMode,planKey:input.planKey,approvalOwner:input.approvalOwner,operatorBrand:input.operatorBrand}});
  return result.data;
}

export async function setAgentServiceStatus(db:SupabaseClient,tenant:AgentServiceTenant,status:"active"|"paused",reason?:string){
  const result=await db.from("agent_service_enrollments").update({status,pause_reason:status==="paused"?(reason?.trim()||"Paused by an authorized user"):null,next_cycle_at:status==="active"?now():undefined,worker_id:null,locked_at:null,lock_expires_at:null,updated_at:now()}).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("*").maybeSingle();
  if(result.error||!result.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
  await db.from("audit_logs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,actor_user_id:tenant.userId,action:`agent_service.${status}`,object_type:"agent_service_enrollment",object_id:result.data.id,after_summary:{status,reason:reason??null}});
  return result.data;
}

export async function changeAgentServicePlan(db:SupabaseClient,tenant:AgentServiceTenant,planKey:string){
  if(!isAgentServicePlanKey(planKey))throw new ApiError("This managed-service plan is not available.",400,"VALIDATION_ERROR");
  const plan=planEntitlements(planKey),result=await db.from("agent_service_enrollments").update({plan_key:planKey,monthly_action_limit:plan.monthlyActionLimit,monthly_provider_budget:plan.monthlyProviderBudget,monthly_human_review_minutes:plan.humanReviewMinutes,cycle_cadence_hours:plan.cycleCadenceHours,updated_at:now()}).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("*").maybeSingle();
  if(result.error||!result.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
  return result.data;
}

export async function updateAgentServiceSettings(db:SupabaseClient,tenant:AgentServiceTenant,input:{approvalOwner?:AgentApprovalOwner;operatorBrand?:"hdseo"|"agency";riskCeiling?:"low"|"medium"|"high";monthlyActionLimit?:number;monthlyProviderBudget?:number;allowedTools?:string[];resalePriceCents?:number;brandName?:string;supportEmail?:string}){
  const update:Record<string,unknown>={updated_at:now()};
  if(input.approvalOwner)update.approval_owner=input.approvalOwner;
  if(input.operatorBrand)update.operator_brand=input.operatorBrand;
  if(input.riskCeiling)update.risk_ceiling=input.riskCeiling;
  if(input.monthlyActionLimit!=null)update.monthly_action_limit=Math.max(0,input.monthlyActionLimit);
  if(input.monthlyProviderBudget!=null)update.monthly_provider_budget=Math.max(0,input.monthlyProviderBudget);
  if(input.allowedTools)update.allowed_tools=input.allowedTools;
  if(input.resalePriceCents!=null)update.resale_price_cents=Math.max(0,input.resalePriceCents);
  const result=await db.from("agent_service_enrollments").update(update).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("*").maybeSingle();
  if(result.error||!result.data)throw new ApiError("Managed agent service is not enrolled for this project.",404,"NOT_FOUND");
  if(input.operatorBrand||input.brandName||input.supportEmail||input.resalePriceCents!=null)await db.from("agency_resale_settings").upsert({agency_id:tenant.agencyId,enabled:input.operatorBrand==="agency",brand_name:input.brandName?.trim()||null,support_email:input.supportEmail?.trim()||null,suggested_resale_price_cents:Math.max(0,input.resalePriceCents??0),updated_at:now()},{onConflict:"agency_id"});
  await db.from("audit_logs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,actor_user_id:tenant.userId,action:"agent_service.settings_updated",object_type:"agent_service_enrollment",object_id:result.data.id,after_summary:{approvalOwner:input.approvalOwner,operatorBrand:input.operatorBrand,riskCeiling:input.riskCeiling,monthlyActionLimit:input.monthlyActionLimit,monthlyProviderBudget:input.monthlyProviderBudget,resalePriceCents:input.resalePriceCents}});
  return result.data;
}

export async function agentServiceSnapshot(db:SupabaseClient,tenant:Omit<AgentServiceTenant,"userId">){
  const enrollment=await db.from("agent_service_enrollments").select("*").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle();
  if(enrollment.error)throw new ApiError("The managed agent service database is not ready. Apply migration 0026.",503,"DATABASE_BINDING_FAILED");
  if(!enrollment.data)return{enrollment:null,cycles:[],usage:[],escalations:[],activeWork:[],approvals:[],summary:null};
  const [cycles,usage,escalations,client]=await Promise.all([
    db.from("agent_service_cycles").select("*").eq("enrollment_id",enrollment.data.id).order("created_at",{ascending:false}).limit(30),
    db.from("agent_service_usage").select("*").eq("enrollment_id",enrollment.data.id).gte("occurred_at",enrollment.data.current_period_start).order("occurred_at",{ascending:false}).limit(100),
    db.from("agent_service_escalations").select("*").eq("enrollment_id",enrollment.data.id).order("created_at",{ascending:false}).limit(50),
    db.from("clients").select("id").eq("agency_id",tenant.agencyId).eq("organization_id",tenant.clientId).single(),
  ]);
  const [activeWork,approvals]=client.data?await Promise.all([
    db.from("agent_work_items").select("id,work_type,goal,assigned_agent_key,status,risk_level,spending_limit,spent_amount,final_outcome,updated_at").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).not("status","in","(succeeded,cancelled,failed,dead_letter)").order("priority",{ascending:false}).limit(30),
    db.from("agent_approvals").select("id,work_item_id,approval_type,title,summary,risk_level,status,requested_at").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).eq("status","awaiting").order("requested_at",{ascending:false}).limit(30),
  ]):[{data:[]},{data:[]}];
  return{enrollment:enrollment.data,cycles:cycles.data??[],usage:usage.data??[],escalations:escalations.data??[],activeWork:activeWork.data??[],approvals:approvals.data??[],summary:{actionsRemaining:Math.max(0,enrollment.data.monthly_action_limit-enrollment.data.actions_used),providerBudgetRemaining:Math.max(0,Number(enrollment.data.monthly_provider_budget)-Number(enrollment.data.provider_spend_used)),openEscalations:(escalations.data??[]).filter(item=>["open","in_progress","waiting"].includes(item.status)).length,nextCycleAt:enrollment.data.next_cycle_at}};
}

export async function resolveAgentServiceEscalation(db:SupabaseClient,tenant:AgentServiceTenant,id:string,resolution:string){
  const result=await db.from("agent_service_escalations").update({status:"resolved",resolution:resolution.trim(),resolved_by:tenant.userId,resolved_at:now(),updated_at:now()}).eq("id",id).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("status","open").select("id").maybeSingle();
  if(result.error||!result.data)throw new ApiError("This escalation is not open or does not belong to this project.",404,"NOT_FOUND");
}
