import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";

import {ApiError,jsonError} from "@/lib/api/errors";
import {parseJson} from "@/lib/api/request";
import {requireLiveAgencyProject} from "@/lib/auth/live-tenant";
import {mergeApprovedPullRequest,type RepositoryConnection} from "@/lib/github/app-client";
import {claimMutationIntent,decideMutationIntent,mutationDigest,requestMutationIntent,settleMutationIntent,type MutationAction} from "@/lib/safety/mutation-gateway";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),idempotencyKey:z.string().trim().min(16).max(200)});
const releaseCheckPolicy={
  health:new Set(["passed"]),
  lighthouse:new Set(["passed","warning"]),
  seo:new Set(["passed"]),
  links:new Set(["passed"]),
  schema:new Set(["passed","warning"]),
  sitemap:new Set(["passed"]),
  robots:new Set(["passed"]),
  indexing_readiness:new Set(["passed"]),
  drift:new Set(["passed","warning","skipped"]),
} as const;

export async function POST(request:Request,{params}:{params:Promise<{executionId:string}>}){
  let intentId:string|null=null,executionRef:string|null=null,db:SupabaseClient|null=null;
  try{
    const input=await parseJson(request,schema),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"execution.approve"});
    if(context.agencyId!==input.agencyId||context.clientId!==input.clientId)throw new ApiError("The selected release does not belong to this workspace.",403,"TENANT_DENIED");
    db=context.db;
    const{executionId}=await params;
    const execution=await db.from("seo_executions").select("id,status,repository_connection_id,pull_request_number,preview_deployment_id,validation_results,outcome_run_id").eq("id",executionId).eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",context.project.id).maybeSingle();
    if(!execution.data)throw new ApiError("Execution not found.",404,"NOT_FOUND");
    if(execution.data.status!=="preview_ready")throw new ApiError("A healthy, independently validated preview is required before release.",409,"APPROVAL_REQUIRED");
    if(!execution.data.repository_connection_id||!execution.data.pull_request_number||!execution.data.preview_deployment_id)throw new ApiError("The release is missing its repository or preview proof.",409,"INVALID_STATE");
    const [connection,deployment,checks]=await Promise.all([
      db.from("repository_connections").select("installation_id,repository_owner,repository_name,default_branch").eq("id",execution.data.repository_connection_id).eq("project_id",context.project.id).maybeSingle(),
      db.from("deployments").select("id,status,url,git_sha,validation_summary").eq("id",execution.data.preview_deployment_id).eq("project_id",context.project.id).eq("environment","preview").maybeSingle(),
      db.from("deployment_checks").select("check_type,status,required,score,details").eq("deployment_id",execution.data.preview_deployment_id),
    ]);
    if(!connection.data?.installation_id||!deployment.data?.git_sha||!['ready','healthy'].includes(deployment.data.status))throw new ApiError("The validated preview is not ready for production release.",409,"APPROVAL_REQUIRED");
    if(checks.error)throw new ApiError("The preview QA record could not be verified.",503,"DATABASE_BINDING_FAILED");
    const checkByType=new Map((checks.data??[]).map(item=>[item.check_type,item])),missing=Object.keys(releaseCheckPolicy).filter(type=>!checkByType.has(type)),unverified=Object.entries(releaseCheckPolicy).flatMap(([type,allowed])=>{const check=checkByType.get(type);return check&&!allowed.has(check.status as never)?[check]:[];});
    if(missing.length||unverified.length)throw new ApiError("Every health, Lighthouse, SEO, link, schema, sitemap, robots, indexing-readiness, and drift check must finish successfully before release.",409,"APPROVAL_REQUIRED");
    const required=(checks.data??[]).filter(item=>item.required);
    const action:MutationAction={agencyId:context.agencyId,clientId:context.clientId,projectId:context.project.id,toolKey:"github.merge",resourceType:"seo_execution",resourceId:executionId,environment:"production",payload:{executionId,pullRequestNumber:execution.data.pull_request_number,expectedHeadSha:deployment.data.git_sha,previewDeploymentId:deployment.data.id,previewUrl:deployment.data.url,requiredChecks:required.map(item=>({type:item.check_type,status:item.status,score:item.score}))}};
    const digest=mutationDigest(action),intent=await requestMutationIntent(db,{action,summary:"Release this exact QA-passed SEO preview to the protected production branch.",riskLevel:"high",approvalPolicy:"human",requestedBy:context.userId,idempotencyKey:`github-merge:${executionId}:${digest}`,expiresInMinutes:30});intentId=intent.id;
    const approved=intent.status==="awaiting"?await decideMutationIntent(db,{intentId:intent.id,agencyId:context.agencyId,projectId:context.project.id,actorId:context.userId,decision:"approved"}):intent;
    if(!['approved','executing'].includes(approved.status))throw new ApiError("The exact production release still needs an authorized approval.",409,"APPROVAL_REQUIRED");
    executionRef=`github-merge:${executionId}:${deployment.data.git_sha}`;await claimMutationIntent(db,{intentId:intent.id,action,executionRef});
    const merged=await mergeApprovedPullRequest(connection.data as RepositoryConnection,{pullRequestNumber:execution.data.pull_request_number,expectedHeadSha:deployment.data.git_sha});
    const saved=await db.from("seo_executions").update({status:"merged",merge_commit_sha:merged.sha,merged_at:new Date().toISOString(),validation_results:{...(execution.data.validation_results??{}),productionRelease:{mutationIntentId:intent.id,actionDigest:digest,previewDeploymentId:deployment.data.id,approvedBy:context.userId,mergedSha:merged.sha,mergedAt:new Date().toISOString()}}}).eq("id",executionId).eq("status","preview_ready").select("id").maybeSingle();
    if(saved.error||!saved.data)throw new ApiError("GitHub merged the pull request, but HD SEO must reconcile the local release record.",503,"DATABASE_BINDING_FAILED");
    await Promise.all([
      db.from("seo_campaign_jobs").update({status:"awaiting_deployment",next_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString()}).contains("result",{executionId}),
      execution.data.outcome_run_id?db.from("outcome_loop_runs").update({status:"publishing",current_step:"publish",updated_at:new Date().toISOString()}).eq("id",execution.data.outcome_run_id):Promise.resolve({error:null}),
    ]);
    await settleMutationIntent(db,{intentId:intent.id,executionRef,status:"succeeded"});
    return Response.json({ok:true,executionId,mergeCommitSha:merged.sha,status:"awaiting_production_deployment"});
  }catch(error){
    if(db&&intentId&&executionRef)await settleMutationIntent(db,{intentId,executionRef,status:"failed",errorCode:error instanceof ApiError?error.code:"OPERATION_FAILED",errorMessage:error instanceof Error?error.message:"Production release failed."}).catch(()=>undefined);
    return jsonError(error);
  }
}
