import {z} from "zod";

import {ApiError,jsonError} from "@/lib/api/errors";
import {parseJson} from "@/lib/api/request";
import {requirePermission,resolveTenantContext} from "@/lib/auth/context";
import {approvedContent,type ExecutionFile} from "@/lib/execution/validation";
import {decideMutationIntent,mutationDigest,requestMutationIntent} from "@/lib/safety/mutation-gateway";
import {repositoryPullRequestPlan} from "@/lib/safety/repository-action";
import {scanGeneratedDiff} from "@/lib/safety/generated-diff-scanner";
import {createSupabaseAdminClient} from "@/lib/supabase/admin";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),action:z.enum(["save","approve","request_revision","cancel"]),files:z.array(z.object({id:z.string().uuid(),decision:z.enum(["approved","rejected"]),humanEditedContent:z.string().optional()})).default([])});

export async function POST(request:Request,{params}:{params:Promise<{executionId:string}>}){try{
  const input=await parseJson(request,schema),context=await resolveTenantContext({agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true});requirePermission(context,"execution.approve");
  const{executionId}=await params,db=createSupabaseAdminClient();if(!db||!context.project)throw new ApiError("Supabase is not configured.",503,"NOT_CONFIGURED");
  const execution=await db.from("seo_executions").select("id,status,opportunity_id,repository_connection_id,base_branch,base_commit_sha,validation_results").eq("id",executionId).eq("agency_id",context.agency.id).eq("client_organization_id",input.clientId).eq("project_id",context.project.id).maybeSingle();
  if(!execution.data)throw new ApiError("Execution not found.",404,"NOT_FOUND");
  if(input.action==="cancel"||input.action==="request_revision"){
    const status=input.action==="cancel"?"cancelled":"revision_requested",updated=await db.from("seo_executions").update({status}).eq("id",executionId).select("id").maybeSingle();if(updated.error||!updated.data)throw new ApiError("The execution decision could not be saved.",409,"CONFLICT");
    return Response.json({ok:true,action:input.action});
  }
  for(const file of input.files){
    const existing=await db.from("seo_execution_files").select("proposed_content").eq("id",file.id).eq("execution_id",executionId).maybeSingle();if(!existing.data)throw new ApiError("Execution file not found.",404,"NOT_FOUND");
    const human=file.humanEditedContent?.trim()||null,updated=await db.from("seo_execution_files").update({status:file.decision,human_edited_content:human,approved_content:file.decision==="approved"?human??existing.data.proposed_content:null}).eq("id",file.id).eq("execution_id",executionId).select("id").maybeSingle();if(updated.error||!updated.data)throw new ApiError("An execution file decision could not be saved.",409,"CONFLICT");
  }
  if(input.action==="approve"){
    const files=await db.from("seo_execution_files").select("*").eq("execution_id",executionId).eq("status","approved");if(files.error||!files.data?.length)throw new ApiError("Approve at least one file.",409,"CONFLICT");
    if(!execution.data.repository_connection_id||!execution.data.base_branch||!execution.data.base_commit_sha)throw new ApiError("Repository execution context is incomplete.",409,"CONFLICT");
    const opportunity=await db.from("seo_opportunities").select("opportunity_score,confidence_score,target_milestone,evidence").eq("id",execution.data.opportunity_id).eq("agency_id",context.agency.id).eq("project_id",context.project.id).maybeSingle();if(!opportunity.data)throw new ApiError("The approved opportunity is unavailable.",409,"CONFLICT");
    const approvedFiles=(files.data as ExecutionFile[]).map(file=>({path:file.file_path,content:approvedContent(file)}));scanGeneratedDiff(approvedFiles);
    const plan=repositoryPullRequestPlan({agencyId:context.agency.id,clientId:input.clientId,projectId:context.project.id,executionId,repositoryConnectionId:execution.data.repository_connection_id,baseBranch:execution.data.base_branch,baseCommitSha:execution.data.base_commit_sha,files:approvedFiles,opportunity:{opportunityScore:opportunity.data.opportunity_score,confidenceScore:opportunity.data.confidence_score,targetMilestone:opportunity.data.target_milestone,evidence:(opportunity.data.evidence??{}) as Record<string,unknown>}}),digest=mutationDigest(plan.action),intent=await requestMutationIntent(db,{action:plan.action,summary:`Create an exact draft pull request with ${plan.files.length} human-reviewed file${plan.files.length===1?"":"s"}.`,riskLevel:"high",approvalPolicy:"human",requestedBy:null,idempotencyKey:`mutation:github-pr:${executionId}:${digest}`,expiresInMinutes:120});
    const approvedIntent=intent.status==="awaiting"?await decideMutationIntent(db,{intentId:intent.id,agencyId:context.agency.id,projectId:context.project.id,actorId:context.user.id,decision:"approved",confirmation:`APPROVE ${intent.action_digest.slice(0,12)}`}):intent;
    if(!["approved","executing"].includes(approvedIntent.status))throw new ApiError("The exact repository action is not approved.",409,"APPROVAL_REQUIRED");
    const validation=execution.data.validation_results&&typeof execution.data.validation_results==="object"&&!Array.isArray(execution.data.validation_results)?execution.data.validation_results:{};
    const saved=await db.from("seo_executions").update({status:"approved",approved_at:new Date().toISOString(),repository_mutation_intent_id:intent.id,repository_action_digest:digest,validation_results:{...validation,repositoryApproval:{mutationIntentId:intent.id,actionDigest:digest,approvedBy:context.user.id,approvedAt:new Date().toISOString()}}}).eq("id",executionId).select("id").maybeSingle();if(saved.error||!saved.data)throw new ApiError("The exact repository approval could not be bound to this execution.",500,"DATABASE_BINDING_FAILED");
    const queued=await db.from("seo_campaign_jobs").update({status:"queued",current_stage:"validate_changes",next_attempt_at:approvedIntent.not_before??new Date().toISOString()}).contains("result",{executionId}).select("id");if(queued.error||!queued.data?.length)throw new ApiError("The approved execution could not be resumed.",500,"DATABASE_BINDING_FAILED");
    return Response.json({ok:true,action:input.action,mutationIntentId:intent.id,actionDigest:digest});
  }
  return Response.json({ok:true,action:input.action});
}catch(error){return jsonError(error)}}
