import {z} from "zod";
import {requireLiveAgencyProject} from "@/lib/auth/live-tenant";
import {parseJson} from "@/lib/api/request";
import {jsonError,ApiError} from "@/lib/api/errors";
import {createManualPackage} from "@/lib/manual/package-service";
import {prepareCampaignCreativeHandoff} from "@/lib/creatives/service";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),decision:z.enum(["proceed","reject"])});
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

export async function POST(request:Request,{params}:{params:Promise<{jobId:string}>}){
  try{
    const input=await parseJson(request,schema),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"draft.approve"});
    if(context.agencyId!==input.agencyId||context.clientId!==input.clientId)throw new ApiError("The selected campaign does not belong to this workspace.",403,"TENANT_DENIED");
    const{jobId}=await params,db=context.db;
    const job=await db.from("seo_campaign_jobs").select("status,result").eq("id",jobId).eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",input.projectId).maybeSingle();
    if(job.error)throw new ApiError("The campaign approval state could not be loaded.",500,"DATABASE_BINDING_FAILED");
    if(!job.data||job.data.status!=="awaiting_opportunity_review")throw new ApiError("This job is not awaiting opportunity review.",409,"CONFLICT");
    const result=record(job.data.result),opportunityId=typeof result.opportunityId==="string"?result.opportunityId:undefined,draftId=typeof result.draftId==="string"?result.draftId:undefined;
    if(!opportunityId||!draftId)throw new ApiError("The selected draft is unavailable.",409,"CONFLICT");

    if(input.decision==="proceed"){
      const[draft,opportunity]=await Promise.all([
        db.from("seo_action_drafts").select("execution_path").eq("id",draftId).eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",input.projectId).maybeSingle(),
        db.from("seo_opportunities").select("action_type").eq("id",opportunityId).eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",input.projectId).maybeSingle()
      ]);
      if(draft.error||opportunity.error)throw new ApiError("The approved implementation recommendation could not be loaded.",500,"DATABASE_BINDING_FAILED");
      if(!draft.data||!opportunity.data)throw new ApiError("The approved implementation recommendation is unavailable.",409,"CONFLICT");

      if(draft.data.execution_path==="repository"){
        await requireLiveAgencyProject({projectId:input.projectId,permission:"execution.approve"});
        const gate=await db.rpc("github_execution_readiness",{target_agency:context.agencyId,target_project:input.projectId});
        if(!gate.data?.ready)throw new ApiError(`Repository execution is blocked: ${(gate.data?.blockers??[]).join(", ")}.`,409,"CONFLICT");

        if(opportunity.data.action_type==="BUILD"||opportunity.data.action_type==="CONTENT"){
          const creative=await prepareCampaignCreativeHandoff(db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,userId:context.userId},opportunityId);
          const creativeResult={...result,creativeSpecId:creative.specId,...("draftId" in creative?{creativeDraftId:creative.draftId}:{}),creativeState:creative.state,requiredAction:"reason" in creative?creative.reason:creative.state==="review_required"?"Review and approve the QA-passed draft in Creative Studio.":null};
          const ready=creative.state==="approved",waitingStatus=creative.state==="evidence_required"?"awaiting_creative_evidence":"awaiting_creative_review";
          const updated=await db.from("seo_campaign_jobs").update({status:ready?"queued":waitingStatus,current_stage:ready?"inspect_repository":"prepare",progress_percent:ready?65:60,next_attempt_at:new Date().toISOString(),result:creativeResult}).eq("id",jobId).eq("status","awaiting_opportunity_review");
          if(updated.error)throw new ApiError("The creative handoff could not be saved.",500,"DATABASE_BINDING_FAILED");
          await db.from("seo_opportunities").update({status:"approved"}).eq("id",opportunityId).eq("project_id",input.projectId);
          return Response.json({ok:true,decision:input.decision,implementationPath:"repository",creativeState:creative.state,creativeSpecId:creative.specId,creativeDraftId:"draftId" in creative?creative.draftId:null,nextStep:ready?"inspect_repository":waitingStatus});
        }

        const updated=await db.from("seo_campaign_jobs").update({status:"queued",current_stage:"inspect_repository",next_attempt_at:new Date().toISOString()}).eq("id",jobId).eq("status","awaiting_opportunity_review");
        if(updated.error)throw new ApiError("Repository execution could not be queued.",500,"DATABASE_BINDING_FAILED");
        await db.from("seo_opportunities").update({status:"approved"}).eq("id",opportunityId).eq("project_id",input.projectId);
        return Response.json({ok:true,decision:input.decision,implementationPath:"repository"});
      }

      const created=await createManualPackage(db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,opportunityId,draftId,createdBy:context.userId,requestedPath:draft.data.execution_path});
      const[updated]=await Promise.all([
        db.from("seo_campaign_jobs").update({status:"awaiting_manual_completion",progress_percent:75,result:{...result,packageId:created.id,taskId:created.taskId}}).eq("id",jobId).eq("status","awaiting_opportunity_review"),
        db.from("seo_opportunities").update({status:"in_progress"}).eq("id",opportunityId).eq("project_id",input.projectId)
      ]);
      if(updated.error)throw new ApiError("The implementation package handoff could not be saved.",500,"DATABASE_BINDING_FAILED");
      return Response.json({ok:true,decision:input.decision,implementationPath:created.implementation_path,packageId:created.id,taskId:created.taskId});
    }

    const[cancelled]=await Promise.all([
      db.from("seo_campaign_jobs").update({status:"cancelled"}).eq("id",jobId).eq("status","awaiting_opportunity_review"),
      db.from("seo_opportunities").update({status:"dismissed"}).eq("id",opportunityId).eq("project_id",input.projectId)
    ]);
    if(cancelled.error)throw new ApiError("The campaign decision could not be saved.",500,"DATABASE_BINDING_FAILED");
    return Response.json({ok:true,decision:input.decision});
  }catch(error){return jsonError(error)}
}
