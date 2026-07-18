import { z } from "zod";

import { resolveTenantContext,requirePermission } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseJson } from "@/lib/api/request";
import { ApiError,jsonError } from "@/lib/api/errors";
import { verifyLiveImplementation } from "@/lib/manual/live-verification";
import { publishCmsPackage,rollbackCmsPublication } from "@/lib/websites/publishing";

const actionSchema=z.object({
  agencyId:z.string().uuid(),
  clientId:z.string().uuid(),
  projectId:z.string().uuid(),
  action:z.enum(["approve","publish_to_client","request_revision","publish_cms","rollback_cms","mark_implemented","verify"]),
  note:z.string().max(4000).optional(),
  liveUrl:z.string().url().optional(),
  proof:z.record(z.string(),z.unknown()).optional(),
  // Accepted for older clients but never trusted as verification evidence.
  checks:z.record(z.string(),z.boolean()).optional(),
  idempotencyKey:z.string().trim().min(8).max(200).optional(),
  publicationId:z.string().uuid().optional(),
});

type AdminDb=NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
async function loadPackage(db:AdminDb,packageId:string,agencyId:string,projectId:string){
  const result=await db.from("implementation_packages").select("*").eq("id",packageId).eq("agency_id",agencyId).eq("project_id",projectId).maybeSingle();
  if(!result.data)throw new ApiError("Implementation package not found.",404,"NOT_FOUND");
  return result.data;
}

export async function GET(request:Request,{params}:{params:Promise<{packageId:string}>}){
  try{
    const url=new URL(request.url),context=await resolveTenantContext({agencyId:url.searchParams.get("agencyId")??undefined,clientId:url.searchParams.get("clientId")??undefined,projectId:url.searchParams.get("projectId")??undefined,requireProject:true}),db=createSupabaseAdminClient(),{packageId}=await params;
    if(!db||!context.project)throw new ApiError("Supabase is not configured.",503,"NOT_CONFIGURED");
    return Response.json({ok:true,package:await loadPackage(db,packageId,context.agency.id,context.project.id)});
  }catch(error){return jsonError(error)}
}

export async function POST(request:Request,{params}:{params:Promise<{packageId:string}>}){
  try{
    const input=await parseJson(request,actionSchema),context=await resolveTenantContext({agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true}),db=createSupabaseAdminClient(),{packageId}=await params;
    if(!db||!context.project||!context.client)throw new ApiError("Supabase is not configured.",503,"NOT_CONFIGURED");
    const pkg=await loadPackage(db,packageId,context.agency.id,context.project.id),timeline={agency_id:context.agency.id,client_organization_id:context.client.id,project_id:context.project.id,opportunity_id:pkg.opportunity_id,package_id:packageId,actor_user_id:context.user.id,metadata:{note:input.note??null}};

    if(input.action==="approve"){
      requirePermission(context,"draft.approve");
      await db.from("implementation_packages").update({status:"approved",approved_by:context.user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",packageId);
      await db.from("proof_of_work_events").insert({...timeline,event_type:"agency_approved",title:"Agency approval completed",description:"The implementation package passed accountable agency review."});
    }else if(input.action==="publish_to_client"){
      requirePermission(context,"client_portal.manage");
      if(!["approved","awaiting_client"].includes(pkg.status))throw new ApiError("Agency approval is required before client publication.",409,"CONFLICT");
      const safePayload={implementationPath:pkg.implementation_path,riskLevel:pkg.risk_level,hypothesis:pkg.hypothesis,summary:pkg.package_data?.metadata??{},acceptanceCriteria:pkg.acceptance_criteria,requiredEvidence:pkg.required_evidence};
      await db.from("client_portal_publications").upsert({agency_id:context.agency.id,client_organization_id:context.client.id,project_id:context.project.id,record_type:"implementation_package",source_id:packageId,title:`SEO implementation: ${pkg.package_data?.keyword??"approved opportunity"}`,summary:"Review the proposed scope, evidence requirements, and acceptance criteria.",status:"awaiting_client",payload:safePayload,published_by:context.user.id,revoked_at:null},{onConflict:"project_id,record_type,source_id"});
      await db.from("implementation_packages").update({status:"awaiting_client",updated_at:new Date().toISOString()}).eq("id",packageId);
      const event=await db.from("proof_of_work_events").select("task_id").eq("package_id",packageId).not("task_id","is",null).limit(1).maybeSingle();
      if(event.data?.task_id)await db.from("seo_task_approvals").upsert({agency_id:context.agency.id,client_organization_id:context.client.id,project_id:context.project.id,task_id:event.data.task_id,approval_type:"client",status:"awaiting",requested_by:context.user.id},{onConflict:"task_id,approval_type"});
      await db.from("proof_of_work_events").insert({...timeline,event_type:"client_approval_requested",title:"Client approval requested",description:"A controlled package summary was published to the client portal.",client_visible:true});
    }else if(input.action==="request_revision"){
      requirePermission(context,"seo.write");
      await db.from("implementation_packages").update({status:"revision_requested",updated_at:new Date().toISOString()}).eq("id",packageId);
      await db.from("proof_of_work_events").insert({...timeline,event_type:"revision_requested",title:"Revision requested",description:input.note??"The package was returned for revision."});
    }else if(input.action==="publish_cms"){
      requirePermission(context,"execution.approve");
      const publication=await publishCmsPackage(db,{packageId,agencyId:context.agency.id,projectId:context.project.id,actorId:context.user.id,idempotencyKey:input.idempotencyKey??`cms:${packageId}:v${pkg.version??1}`});
      return Response.json({ok:true,action:input.action,packageId,publication});
    }else if(input.action==="rollback_cms"){
      requirePermission(context,"deploy.rollback");
      if(!input.publicationId)throw new ApiError("A CMS publication ID is required for rollback.",400,"VALIDATION_ERROR");
      const publication=await rollbackCmsPublication(db,{publicationId:input.publicationId,agencyId:context.agency.id,projectId:context.project.id,actorId:context.user.id});
      return Response.json({ok:true,action:input.action,packageId,publication});
    }else if(input.action==="mark_implemented"){
      requirePermission(context,"seo.write");
      if(!input.liveUrl)throw new ApiError("A live URL is required.",400,"VALIDATION_ERROR");
      await db.from("implementation_packages").update({status:"implemented_unverified",implemented_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",packageId);
      await db.from("implementation_verifications").upsert({agency_id:context.agency.id,client_organization_id:context.client.id,project_id:context.project.id,package_id:packageId,live_url:input.liveUrl,status:"pending",proof:input.proof??{},checks:{},error_details:{}},{onConflict:"package_id"});
      await db.from("proof_of_work_events").insert({...timeline,event_type:"implementation_reported",title:"Implementation reported",description:"Completion was reported and is awaiting independent live verification.",client_visible:true});
    }else{
      requirePermission(context,"execution.approve");
      const pending=await db.from("implementation_verifications").select("id,live_url,proof").eq("package_id",packageId).eq("status","pending").maybeSingle();
      if(!pending.data)throw new ApiError("Record implementation proof before verification.",409,"CONFLICT");
      const automated=await verifyLiveImplementation({liveUrl:pending.data.live_url,packageData:pkg.package_data});
      if(!automated.passed){
        await db.from("implementation_verifications").update({checks:automated.checks,error_details:{failed:automated.failed,page:automated.page},updated_at:new Date().toISOString()}).eq("id",pending.data.id);
        throw new ApiError(`Automated live verification failed: ${automated.failed.join(", ")}.`,409,"WEBSITE_VERIFICATION_FAILED");
      }
      const verification=await db.from("implementation_verifications").update({status:"passed",checks:automated.checks,proof:{...((pending.data.proof&&typeof pending.data.proof==="object")?pending.data.proof:{}),...(input.proof??{}),automatedPage:automated.page},error_details:{},verified_by:context.user.id,verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",pending.data.id).eq("status","pending").select("id").maybeSingle();
      if(!verification.data)throw new ApiError("The implementation verification changed while checks were running.",409,"CONFLICT");
      const plan=await db.rpc("create_manual_monitoring_plan",{p_package_id:packageId,p_verified_by:context.user.id});
      if(plan.error){await db.from("implementation_verifications").update({status:"pending",verified_by:null,verified_at:null}).eq("id",pending.data.id);throw new ApiError("Monitoring checkpoints could not be scheduled.",500,"OPERATION_FAILED");}
      await db.from("proof_of_work_events").insert({...timeline,event_type:"live_verification_passed",title:"Automated live verification passed",description:"Independent live checks passed and 7/14/30/60/90-day monitoring was scheduled.",client_visible:true,metadata:{...timeline.metadata,monitoringPlanId:plan.data,page:automated.page}});
    }
    return Response.json({ok:true,action:input.action,packageId});
  }catch(error){return jsonError(error)}
}
