import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/config/env";
import { ApiError, logEvent } from "@/lib/api/errors";
import type { ProviderOperation } from "./dataforseo/types";
import { createHash } from "node:crypto";
import {reserveManagedProviderCost,settleManagedProviderCost} from "@/lib/agent-service/cost-control";

export interface PaidRunContext { db: SupabaseClient; usageId: string; lockId: string; agencyId: string; clientId: string; projectId: string; managedCostReservation:{usageId:string}|null }
export interface PaidTenantContext {
  user: { id: string };
  agency: { id: string };
  client?: { id: string };
  project?: { id: string };
}

export function paidScopeHash(value:unknown){return createHash("sha256").update(JSON.stringify(value,Object.keys(value as Record<string,unknown>).sort())).digest("hex");}

export async function beginPaidOperation(context: PaidTenantContext, input: { confirmationId: string; operation: ProviderOperation; estimatedUnits: number; estimatedCost: number; scopeHash:string }): Promise<PaidRunContext> {
  if (!context.client || !context.project) throw new ApiError("A client project is required.", 400, "VALIDATION_ERROR");
  const db = createSupabaseAdminClient();
  if (!db) throw new ApiError("Supabase server configuration is incomplete.", 503, "NOT_CONFIGURED");
  const confirmation = await db.from("provider_operation_confirmations").select("id,provider,operation_type,estimated_units,estimated_cost,expires_at,requested_by,scope_hash,consumed_at").eq("id", input.confirmationId).eq("agency_id", context.agency.id).eq("project_id", context.project.id).eq("requested_by", context.user.id).maybeSingle();
  if (!confirmation.data || confirmation.data.provider !== "dataforseo" || confirmation.data.operation_type !== input.operation || new Date(confirmation.data.expires_at) <= new Date()) throw new ApiError("A current paid-operation confirmation is required.", 409, "CONFLICT");
  if (Number(confirmation.data.estimated_units) !== input.estimatedUnits || Number(confirmation.data.estimated_cost) !== input.estimatedCost) throw new ApiError("The confirmed request scope has changed.", 409, "CONFLICT");
  if(confirmation.data.scope_hash!==input.scopeHash||confirmation.data.consumed_at)throw new ApiError("The paid-operation confirmation does not match this exact request or was already used.",409,"CONFLICT");
  const consumed=await db.from("provider_operation_confirmations").update({consumed_at:new Date().toISOString()}).eq("id",input.confirmationId).is("consumed_at",null).select("id").maybeSingle();
  if(!consumed.data)throw new ApiError("The paid-operation confirmation was already consumed.",409,"CONFLICT");
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const [spendResult,platformSpendResult] = await Promise.all([
    db.from("data_usage_events").select("actual_cost,estimated_cost,status").eq("agency_id", context.agency.id).gte("created_at", since.toISOString()),
    db.from("data_usage_events").select("actual_cost,estimated_cost,status").eq("provider","dataforseo").gte("created_at", since.toISOString()),
  ]);
  const total=(rows:Array<{actual_cost:unknown;estimated_cost:unknown;status:unknown}>)=>rows.reduce((sum,row)=>sum+Number(row.actual_cost??(row.status==="completed"?row.estimated_cost:0)??0),0);
  const spend=total(spendResult.data??[]),platformSpend=total(platformSpendResult.data??[]);
  if (spend + input.estimatedCost > env.MAX_DAILY_DATAFORSEO_COST_USD) throw new ApiError("The daily DataForSEO budget would be exceeded.", 409, "CONFLICT");
  if (platformSpend + input.estimatedCost > env.MAX_DAILY_DATAFORSEO_PLATFORM_COST_USD) throw new ApiError("The platform-wide DataForSEO safety ceiling has been reached. No provider request was sent.",409,"PROVIDER_BUDGET_EXCEEDED");
  await db.from("provider_job_locks").delete().eq("agency_id", context.agency.id).eq("project_id", context.project.id).eq("operation_type", input.operation).lt("expires_at", new Date().toISOString());
  const lockKey = `${context.agency.id}:${context.project.id}:${input.operation}`;
  const lock = await db.from("provider_job_locks").insert({ agency_id: context.agency.id, project_id: context.project.id, operation_type: input.operation, lock_key: lockKey, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }).select("id").single();
  if (!lock.data) throw new ApiError("A matching provider operation is already running.", 409, "CONFLICT");
  const usage = await db.from("data_usage_events").insert({ agency_id: context.agency.id, client_organization_id: context.client.id, project_id: context.project.id, provider: "dataforseo", operation_type: input.operation, requested_by: context.user.id, confirmation_id: input.confirmationId, units: input.estimatedUnits, estimated_cost: input.estimatedCost, status: "running" }).select("id").single();
  if (!usage.data) { await db.from("provider_job_locks").delete().eq("id", lock.data.id); throw new ApiError("Usage logging failed.", 500, "OPERATION_FAILED"); }
  let managedCostReservation:{usageId:string}|null=null;
  try{managedCostReservation=await reserveManagedProviderCost(db,{agencyId:context.agency.id,clientId:context.client.id,projectId:context.project.id},{estimatedCost:input.estimatedCost,idempotencyKey:`dataforseo:${usage.data.id}`,provider:"dataforseo",operation:input.operation});}
  catch(error){await db.from("data_usage_events").update({actual_cost:0,units:0,status:"failed"}).eq("id",usage.data.id);await db.from("provider_job_locks").delete().eq("id",lock.data.id);throw error;}
  logEvent("provider_run_started", { agencyId: context.agency.id, projectId: context.project.id, provider: "dataforseo", operation: input.operation });
  return { db, usageId: usage.data.id, lockId: lock.data.id, agencyId: context.agency.id, clientId: context.client.id, projectId: context.project.id,managedCostReservation };
}

export async function finishPaidOperation(context: PaidRunContext, values: { cost: number; units: number; status: "completed" | "failed"; error?: string }) {
  await context.db.from("data_usage_events").update({ actual_cost: values.cost, units: values.units, status: values.status }).eq("id", context.usageId);
  await settleManagedProviderCost(context.db,context.managedCostReservation,{actualCost:values.cost,status:values.status,provider:"dataforseo"});
  await context.db.from("provider_job_locks").delete().eq("id", context.lockId);
  logEvent("provider_run_finished", { agencyId: context.agencyId, projectId: context.projectId, provider: "dataforseo", status: values.status });
}
