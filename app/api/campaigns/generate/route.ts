import { createHash } from "node:crypto";
import { z } from "zod";
import { resolveTenantContext, requirePermission } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseJson } from "@/lib/api/request";
import { jsonError, ApiError, logEvent } from "@/lib/api/errors";
import { systemReadiness } from "@/lib/readiness/system-readiness";
import { env, hasDataForSeoConfig } from "@/lib/config/env";
import {
  domainDiscoveryScope,
  estimatedDomainDiscoveryCost,
} from "@/lib/seo/autonomous-discovery";
import { paidScopeHash } from "@/lib/providers/paid-operation";
import { loadProjectServiceAreaPolicy } from "@/lib/seo/service-area-server";
import { resolveLabsLocation } from "@/lib/providers/dataforseo/locations";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),campaignId:z.string().uuid().optional(),automationMode:z.enum(["MONITOR","RECOMMEND","PREPARE","EXECUTE_WITH_APPROVAL"]).default("PREPARE"),minimumConfidence:z.number().int().min(0).max(100).default(55),monthlyBudget:z.number().positive().max(10_000_000).default(1500),targetMarket:z.string().trim().min(2).max(100).optional(),discoveryLimit:z.number().int().min(10).max(100).default(50),authorizeDataSpend:z.boolean().default(false)});
export async function POST(request:Request){
  try{
    const input=await parseJson(request,schema),context=await resolveTenantContext({agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true});
    requirePermission(context,input.automationMode==="EXECUTE_WITH_APPROVAL"?"execution.approve":"seo.write");
    if(!context.client||!context.project)throw new ApiError("A project is required.",400,"VALIDATION_ERROR");
    const readiness=await systemReadiness(context.project.id);
    if(!readiness.ready)throw new ApiError("The automation foundation is not ready.",409,"CONFLICT");
    const db=createSupabaseAdminClient();
    if(!db)throw new ApiError("Supabase is not configured.",503,"NOT_CONFIGURED");
    if(input.campaignId){
      const campaign=await db.from("seo_campaigns").select("id").eq("id",input.campaignId).eq("agency_id",context.agency.id).eq("client_organization_id",context.client.id).eq("project_id",context.project.id).maybeSingle();
      if(!campaign.data)throw new ApiError("Campaign not found for this project.",404,"NOT_FOUND");
    }
    if(input.automationMode==="EXECUTE_WITH_APPROVAL"){
      const gate=await db.rpc("github_execution_readiness",{target_agency:context.agency.id,target_project:context.project.id});
      if(!gate.data?.ready)throw new ApiError(`Repository execution is not ready: ${(gate.data?.blockers??[]).join(", ")}.`,409,"CONFLICT");
    }
    const hour=new Date().toISOString().slice(0,13),idempotencyKey=createHash("sha256").update(`${context.agency.id}:${context.project.id}:${context.user.id}:${hour}:${JSON.stringify(input)}`).digest("hex"),existing=await db.from("seo_campaign_jobs").select("id,status,reference_id").eq("idempotency_key",idempotencyKey).maybeSingle();
    if(existing.data&&!['awaiting_data_connection','failed','cancelled','stale'].includes(existing.data.status))return Response.json({ok:true,jobId:existing.data.id,status:existing.data.status,referenceId:existing.data.reference_id,duplicate:true},{status:202});
    if(existing.data){const released=await db.from("seo_campaign_jobs").update({idempotency_key:`${idempotencyKey}:superseded:${crypto.randomUUID()}`}).eq("id",existing.data.id);if(released.error)throw new ApiError("The previous discovery run could not be superseded.",500,"OPERATION_FAILED");}
    const project=await db.from("seo_projects").select("domain,country_code,language_code").eq("id",context.project.id).single();
    if(!project.data)throw new ApiError("Project discovery settings are unavailable.",409,"CONFLICT");
    const serviceAreaPolicy=await loadProjectServiceAreaPolicy(db,context.project.id,input.targetMarket);
    const targetMarket=serviceAreaPolicy.targetMarket;
    const providerLocation=input.authorizeDataSpend?await resolveLabsLocation(project.data.country_code||"US",project.data.language_code||"en"):null;
    let discoveryConfirmationId:string|null=null;
    const effectiveDiscoveryLimit=Math.min(env.MAX_KEYWORDS_PER_RUN,input.discoveryLimit);
    if(input.authorizeDataSpend){
      requirePermission(context,"provider.authorize");
      if(!hasDataForSeoConfig)throw new ApiError("DataForSEO is not configured. Connect Search Console or configure DataForSEO.",503,"NOT_CONFIGURED");
      const limit=effectiveDiscoveryLimit,scope=domainDiscoveryScope({domain:project.data.domain,targetMarket,locationCode:providerLocation!.locationCode,languageCode:project.data.language_code||"en",limit}),estimatedCost=estimatedDomainDiscoveryCost(limit),confirmation=await db.from("provider_operation_confirmations").insert({agency_id:context.agency.id,client_organization_id:context.client.id,project_id:context.project.id,provider:"dataforseo",operation_type:"keyword_discovery",requested_by:context.user.id,estimated_units:limit,estimated_cost:estimatedCost,scope,scope_hash:paidScopeHash(scope),expires_at:new Date(Date.now()+30*60_000).toISOString()}).select("id").single();
      if(!confirmation.data)throw new ApiError("Keyword discovery authorization could not be recorded.",500,"OPERATION_FAILED");
      discoveryConfirmationId=confirmation.data.id;
    }
    const referenceId=crypto.randomUUID(),jobInput={...input,targetMarket,serviceAreas:serviceAreaPolicy.serviceAreas.map(area=>area.name),dataForSeoLocationCode:providerLocation?.locationCode??null,discoveryLimit:effectiveDiscoveryLimit,discoveryConfirmationId},job=await db.from("seo_campaign_jobs").insert({agency_id:context.agency.id,client_organization_id:context.client.id,project_id:context.project.id,campaign_id:input.campaignId??null,requested_by:context.user.id,status:"queued",current_stage:"discover",input:jobInput,idempotency_key:idempotencyKey,reference_id:referenceId}).select("id,status").single();
    if(!job.data)throw new ApiError("The job could not be created.",500,"OPERATION_FAILED",referenceId);
    logEvent("job_created",{jobId:job.data.id,agencyId:context.agency.id,projectId:context.project.id,referenceId,automaticDiscovery:true});
    return Response.json({ok:true,jobId:job.data.id,status:job.data.status,referenceId,discovery:{firstParty:true,authorizedProviderSpend:input.authorizeDataSpend}},{status:202});
  }catch(error){return jsonError(error)}
}
