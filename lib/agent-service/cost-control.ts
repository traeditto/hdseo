import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";
import {ApiError,type ApiErrorCode} from "@/lib/api/errors";
import {env} from "@/lib/config/env";
import {calculateModelCost,estimateMaximumModelCost,type TokenUsage} from "@/lib/agent-service/economics";

export {calculateModelCost,estimateMaximumModelCost};
export type {TokenUsage};

export type CostTenant={agencyId:string;clientId:string;projectId:string};
type ManagedReservation={usageId:string}|null;

export async function reserveModelCost(db:SupabaseClient,tenant:CostTenant,input:{operation:string;model:string;estimatedCost:number;idempotencyKey:string;metadata?:Record<string,unknown>}){
  if(input.estimatedCost>env.OPENAI_MAX_COST_PER_REQUEST_USD)throw new ApiError("This model request exceeds the per-request cost ceiling and was stopped before any API charge.",409,"MODEL_REQUEST_COST_LIMIT");
  const global=await db.rpc("reserve_model_usage",{p_agency_id:tenant.agencyId,p_client_organization_id:tenant.clientId,p_project_id:tenant.projectId,p_operation_type:input.operation,p_model:input.model,p_estimated_cost:input.estimatedCost,p_project_daily_limit:env.OPENAI_MAX_DAILY_COST_PER_PROJECT_USD,p_platform_daily_limit:env.OPENAI_MAX_DAILY_PLATFORM_COST_USD,p_idempotency_key:input.idempotencyKey,p_metadata:input.metadata??{}});
  if(global.error)throw new ApiError("Model cost controls are not ready. Apply migration 0027.",503,"DATABASE_BINDING_FAILED");
  if(!global.data?.allowed){const reason=String(global.data?.reason),code:ApiErrorCode=reason==="PROJECT_DAILY_MODEL_BUDGET_EXCEEDED"?reason:reason==="PLATFORM_DAILY_MODEL_BUDGET_EXCEEDED"?reason:"OPERATION_FAILED";throw new ApiError("The safe model-usage budget has been reached. No API request was sent.",409,code);}
  const enrollment=await db.from("agent_service_enrollments").select("id").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).in("status",["trialing","active"]).maybeSingle();
  let managed:ManagedReservation=null;
  if(enrollment.data){
    const reserved=await db.rpc("reserve_agent_service_provider_cost",{p_enrollment_id:enrollment.data.id,p_estimated_cost:input.estimatedCost,p_idempotency_key:`model:${input.idempotencyKey}`,p_metadata:{provider:"openai",operation:input.operation,model:input.model}});
    if(reserved.error||!reserved.data?.allowed){
      await db.rpc("settle_model_usage",{p_usage_id:global.data.usageId,p_status:"failed",p_actual_cost:0,p_input_tokens:0,p_cached_input_tokens:0,p_output_tokens:0,p_metadata:{reason:"managed_provider_budget_blocked"}});
      if(reserved.error)throw new ApiError("Managed provider cost controls are not ready. Apply migration 0027.",503,"DATABASE_BINDING_FAILED");
      throw new ApiError("This managed plan's provider-cost ceiling has been reached. No API request was sent.",409,"PROVIDER_BUDGET_EXCEEDED");
    }
    managed={usageId:String(reserved.data.usageId)};
  }
  return{usageId:String(global.data.usageId),managed,estimatedCost:input.estimatedCost};
}

export async function settleModelCost(db:SupabaseClient,reservation:Awaited<ReturnType<typeof reserveModelCost>>,input:{status:"completed"|"failed";actualCost:number;usage?:TokenUsage;metadata?:Record<string,unknown>}){
  const usage=input.usage??{inputTokens:0,cachedInputTokens:0,outputTokens:0};
  await db.rpc("settle_model_usage",{p_usage_id:reservation.usageId,p_status:input.status,p_actual_cost:input.status==="completed"?input.actualCost:0,p_input_tokens:usage.inputTokens,p_cached_input_tokens:usage.cachedInputTokens,p_output_tokens:usage.outputTokens,p_metadata:input.metadata??{}});
  if(reservation.managed)await db.rpc("settle_agent_service_provider_cost",{p_usage_id:reservation.managed.usageId,p_actual_cost:input.status==="completed"?input.actualCost:0,p_status:input.status,p_metadata:{provider:"openai",...(input.metadata??{})}});
}

export async function reserveManagedProviderCost(db:SupabaseClient,tenant:CostTenant,input:{estimatedCost:number;idempotencyKey:string;provider:string;operation:string}){
  const enrollment=await db.from("agent_service_enrollments").select("id").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).in("status",["trialing","active"]).maybeSingle();
  if(!enrollment.data)return null;
  const reserved=await db.rpc("reserve_agent_service_provider_cost",{p_enrollment_id:enrollment.data.id,p_estimated_cost:input.estimatedCost,p_idempotency_key:input.idempotencyKey,p_metadata:{provider:input.provider,operation:input.operation}});
  if(reserved.error)throw new ApiError("Managed provider cost controls are not ready. Apply migration 0027.",503,"DATABASE_BINDING_FAILED");
  if(!reserved.data?.allowed)throw new ApiError("This managed plan's provider-cost ceiling has been reached. No provider request was sent.",409,"PROVIDER_BUDGET_EXCEEDED");
  return{usageId:String(reserved.data.usageId)};
}

export async function settleManagedProviderCost(db:SupabaseClient,reservation:{usageId:string}|null,input:{actualCost:number;status:"completed"|"failed";provider:string}){
  if(!reservation)return;
  await db.rpc("settle_agent_service_provider_cost",{p_usage_id:reservation.usageId,p_actual_cost:input.status==="completed"?input.actualCost:0,p_status:input.status,p_metadata:{provider:input.provider}});
}
