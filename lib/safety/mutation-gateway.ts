import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";

import {ApiError} from "@/lib/api/errors";
import {actionDigest} from "@/lib/safety/action-digest";

export const guardedTools=["vercel.deploy","vercel.rollback","cms.publish","cms.rollback","github.write","github.merge","authority.outreach"] as const;
export type GuardedTool=(typeof guardedTools)[number];
export type MutationRisk="low"|"medium"|"high"|"critical";
export type ApprovalPolicy="rbac_auto"|"human"|"client_package"|"system_rollback";

export interface MutationAction{
  agencyId:string;
  clientId:string;
  projectId:string;
  toolKey:GuardedTool;
  resourceType:string;
  resourceId?:string|null;
  environment?:string|null;
  payload:Record<string,unknown>;
}

export function mutationEnvelope(action:MutationAction){
  return{
    tenant:{agencyId:action.agencyId,clientId:action.clientId,projectId:action.projectId},
    toolKey:action.toolKey,
    resource:{type:action.resourceType,id:action.resourceId??null},
    environment:action.environment??null,
    payload:action.payload,
  };
}

export function mutationDigest(action:MutationAction){return actionDigest(mutationEnvelope(action));}

export async function requestMutationIntent(db:SupabaseClient,input:{
  action:MutationAction;summary:string;riskLevel:MutationRisk;approvalPolicy:ApprovalPolicy;
  requestedBy:string|null;idempotencyKey:string;expiresInMinutes?:number;workItemId?:string|null;
}){
  const digest=mutationDigest(input.action),automatic=input.approvalPolicy!=="human",now=new Date(),expiresAt=new Date(now.getTime()+Math.max(5,Math.min(input.expiresInMinutes??30,24*60))*60_000).toISOString();
  const existing=await db.from("mutation_intents").select("id,action_digest,status,approval_policy,expires_at,trace_id,requested_by,approved_by").eq("agency_id",input.action.agencyId).eq("idempotency_key",input.idempotencyKey).maybeSingle();
  if(existing.error)throw new ApiError("The protected action could not be checked.",500,"DATABASE_BINDING_FAILED");
  if(existing.data){
    if(existing.data.action_digest!==digest)throw new ApiError("This idempotency key already protects a different action.",409,"CONFLICT");
    if(automatic&&["failed","expired"].includes(existing.data.status)){
      const renewed=await db.from("mutation_intents").update({status:"approved",approved_by:input.requestedBy,approved_at:now.toISOString(),expires_at:expiresAt,execution_ref:null,execution_started_at:null,completed_at:null,failure_code:null,failure_message:null,updated_at:now.toISOString()}).eq("id",existing.data.id).eq("action_digest",digest).in("status",["failed","expired"]).select("id,action_digest,status,approval_policy,expires_at,trace_id,requested_by,approved_by").maybeSingle();
      if(renewed.error||!renewed.data)throw new ApiError("The protected action retry could not be registered.",409,"CONFLICT");
      return renewed.data;
    }
    if(!automatic&&(["expired"].includes(existing.data.status)||(["awaiting","approved"].includes(existing.data.status)&&new Date(existing.data.expires_at).getTime()<=now.getTime()))){
      const renewed=await db.from("mutation_intents").update({status:"awaiting",requested_by:input.requestedBy,approved_by:null,approved_at:null,expires_at:expiresAt,execution_ref:null,execution_started_at:null,completed_at:null,failure_code:null,failure_message:null,updated_at:now.toISOString()}).eq("id",existing.data.id).eq("action_digest",digest).in("status",["awaiting","approved","expired"]).select("id,action_digest,status,approval_policy,expires_at,trace_id,requested_by,approved_by").maybeSingle();
      if(renewed.error||!renewed.data)throw new ApiError("The expired protected action could not be renewed.",409,"CONFLICT");
      return renewed.data;
    }
    if(!automatic&&existing.data.status==="failed"&&existing.data.approved_by){
      const retried=await db.from("mutation_intents").update({status:"approved",expires_at:expiresAt,execution_ref:null,execution_started_at:null,completed_at:null,failure_code:null,failure_message:null,updated_at:now.toISOString()}).eq("id",existing.data.id).eq("action_digest",digest).eq("status","failed").select("id,action_digest,status,approval_policy,expires_at,trace_id,requested_by,approved_by").maybeSingle();
      if(retried.error||!retried.data)throw new ApiError("The approved protected action could not be retried.",409,"CONFLICT");
      return retried.data;
    }
    return existing.data;
  }
  const inserted=await db.from("mutation_intents").insert({
    agency_id:input.action.agencyId,client_organization_id:input.action.clientId,project_id:input.action.projectId,
    work_item_id:input.workItemId??null,tool_key:input.action.toolKey,resource_type:input.action.resourceType,
    resource_id:input.action.resourceId??null,environment:input.action.environment??null,summary:input.summary,
    risk_level:input.riskLevel,approval_policy:input.approvalPolicy,action_payload:mutationEnvelope(input.action),
    action_digest:digest,status:automatic?"approved":"awaiting",requested_by:input.requestedBy,
    approved_by:automatic?input.requestedBy:null,approved_at:automatic?now.toISOString():null,
    idempotency_key:input.idempotencyKey,expires_at:expiresAt,updated_at:now.toISOString(),
  }).select("id,action_digest,status,approval_policy,expires_at,trace_id,requested_by,approved_by").single();
  if(inserted.error?.code==="23505"){
    const raced=await db.from("mutation_intents").select("id,action_digest,status,approval_policy,expires_at,trace_id,requested_by,approved_by").eq("agency_id",input.action.agencyId).eq("idempotency_key",input.idempotencyKey).maybeSingle();
    if(raced.data?.action_digest===digest)return raced.data;
    if(raced.data)throw new ApiError("This idempotency key already protects a different action.",409,"CONFLICT");
  }
  if(inserted.error||!inserted.data)throw new ApiError("The protected action could not be registered.",500,"DATABASE_BINDING_FAILED");
  return inserted.data;
}

export async function decideMutationIntent(db:SupabaseClient,input:{
  intentId:string;agencyId:string;projectId:string;actorId:string;decision:"approved"|"rejected";
}){
  const intent=await db.from("mutation_intents").select("id,status,risk_level,requested_by,expires_at,action_digest").eq("id",input.intentId).eq("agency_id",input.agencyId).eq("project_id",input.projectId).maybeSingle();
  if(!intent.data)throw new ApiError("Protected action not found.",404,"NOT_FOUND");
  if(intent.data.status!=="awaiting")throw new ApiError("This protected action has already been decided.",409,"CONFLICT");
  if(new Date(intent.data.expires_at).getTime()<=Date.now()){
    await db.from("mutation_intents").update({status:"expired",updated_at:new Date().toISOString()}).eq("id",input.intentId).eq("status","awaiting");
    throw new ApiError("This protected action expired. Request a new approval.",409,"CONFLICT");
  }
  if(["high","critical"].includes(intent.data.risk_level)&&intent.data.requested_by===input.actorId){
    const eligible=await db.from("agency_members").select("id",{head:true,count:"exact"}).eq("agency_id",input.agencyId).eq("status","active").in("role",["agency_owner","agency_admin","seo_director"]);
    if((eligible.count??0)>1)throw new ApiError("This agency has multiple authorized approvers, so high-risk work requires a different person to approve it.",403,"ROLE_FORBIDDEN");
  }
  const now=new Date().toISOString(),updated=await db.from("mutation_intents").update({status:input.decision,approved_by:input.decision==="approved"?input.actorId:null,approved_at:input.decision==="approved"?now:null,updated_at:now}).eq("id",input.intentId).eq("status","awaiting").select("id,status,action_digest,expires_at").maybeSingle();
  if(updated.error||!updated.data)throw new ApiError("The protected action changed while the decision was recorded.",409,"CONFLICT");
  return updated.data;
}

export async function assertMutationApproved(db:SupabaseClient,input:{intentId:string;action:MutationAction}){
  const digest=mutationDigest(input.action),intent=await db.from("mutation_intents").select("id,status,action_digest,tool_key,expires_at,approval_policy,trace_id").eq("id",input.intentId).eq("agency_id",input.action.agencyId).eq("client_organization_id",input.action.clientId).eq("project_id",input.action.projectId).maybeSingle();
  if(!intent.data)throw new ApiError("An approved protected action is required.",409,"APPROVAL_REQUIRED");
  if(intent.data.tool_key!==input.action.toolKey||intent.data.action_digest!==digest)throw new ApiError("The approved action does not match this request.",409,"INVALID_STATE");
  if(!["approved","executing"].includes(intent.data.status))throw new ApiError("This protected action is not approved.",409,"APPROVAL_REQUIRED");
  // Expiry prevents a new external write from starting. Once the exact action
  // has been claimed, the same fenced execution must remain able to reconcile
  // a provider success after a timeout or worker restart.
  if(intent.data.status==="approved"&&new Date(intent.data.expires_at).getTime()<=Date.now())throw new ApiError("The protected action approval expired.",409,"APPROVAL_REQUIRED");
  return{...intent.data,digest};
}

export async function claimMutationIntent(db:SupabaseClient,input:{intentId:string;action:MutationAction;executionRef:string}){
  const approved=await assertMutationApproved(db,input),now=new Date().toISOString();
  const claimed=await db.from("mutation_intents").update({status:"executing",execution_ref:input.executionRef,execution_started_at:now,updated_at:now}).eq("id",input.intentId).eq("status","approved").select("id,status,execution_ref,trace_id").maybeSingle();
  if(claimed.data)return claimed.data;
  const resumed=await db.from("mutation_intents").select("id,status,execution_ref,trace_id").eq("id",input.intentId).eq("status","executing").eq("execution_ref",input.executionRef).maybeSingle();
  if(!resumed.data)throw new ApiError("Another execution already claimed this protected action.",409,"CONFLICT");
  return{...resumed.data,trace_id:resumed.data.trace_id??approved.trace_id};
}

export async function claimStoredMutationIntent(db:SupabaseClient,input:{intentId:string;agencyId:string;projectId:string;toolKey:GuardedTool;expectedDigest:string;executionRef:string}){
  const intent=await db.from("mutation_intents").select("id,status,action_digest,action_payload,tool_key,expires_at,execution_ref,trace_id").eq("id",input.intentId).eq("agency_id",input.agencyId).eq("project_id",input.projectId).maybeSingle();
  if(!intent.data)throw new ApiError("The external write has no protected action record.",409,"APPROVAL_REQUIRED");
  const storedDigest=actionDigest(intent.data.action_payload);
  if(intent.data.tool_key!==input.toolKey||intent.data.action_digest!==input.expectedDigest||storedDigest!==input.expectedDigest)throw new ApiError("The external write no longer matches its approved action.",409,"INVALID_STATE");
  if(intent.data.status==="executing"&&intent.data.execution_ref===input.executionRef)return intent.data;
  if(intent.data.status!=="approved")throw new ApiError("The protected action cannot be executed in its current state.",409,"APPROVAL_REQUIRED");
  if(new Date(intent.data.expires_at).getTime()<=Date.now())throw new ApiError("The protected action approval expired before execution.",409,"APPROVAL_REQUIRED");
  const now=new Date().toISOString(),claimed=await db.from("mutation_intents").update({status:"executing",execution_ref:input.executionRef,execution_started_at:now,updated_at:now}).eq("id",input.intentId).eq("status","approved").select("id,status,execution_ref,trace_id").maybeSingle();
  if(!claimed.data)throw new ApiError("Another execution claimed this protected action.",409,"CONFLICT");
  return claimed.data;
}

export async function settleMutationIntent(db:SupabaseClient,input:{intentId:string;executionRef:string;status:"succeeded"|"failed";errorCode?:string;errorMessage?:string}){
  const now=new Date().toISOString(),updated=await db.from("mutation_intents").update({status:input.status,completed_at:now,failure_code:input.errorCode??null,failure_message:input.errorMessage?.slice(0,500)??null,updated_at:now}).eq("id",input.intentId).eq("status","executing").eq("execution_ref",input.executionRef).select("id").maybeSingle();
  if(updated.error||!updated.data)throw new ApiError("The protected action result could not be settled.",500,"DATABASE_BINDING_FAILED");
}
