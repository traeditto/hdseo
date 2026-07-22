import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";

import {ApiError} from "@/lib/api/errors";
import {mergeApprovedPullRequest,type RepositoryConnection} from "@/lib/github/app-client";
import {claimMutationIntent,mutationDigest,requestMutationIntent,settleMutationIntent,type MutationAction} from "@/lib/safety/mutation-gateway";

const object=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

export async function releaseAutopilotPreview(db:SupabaseClient,input:{executionId:string;agencyId:string;clientId:string;projectId:string}){
  const execution=await db.from("seo_executions").select("id,status,repository_connection_id,pull_request_number,preview_deployment_id,validation_results,outcome_run_id").eq("id",input.executionId).eq("agency_id",input.agencyId).eq("client_organization_id",input.clientId).eq("project_id",input.projectId).maybeSingle();
  if(!execution.data||execution.data.status!=="preview_ready"||!execution.data.outcome_run_id)return{released:false,reason:"not_autopilot_ready"};
  if(!execution.data.repository_connection_id||!execution.data.pull_request_number||!execution.data.preview_deployment_id)throw new ApiError("The Autopilot release is missing repository or preview proof.",409,"INVALID_STATE");
  const validation=object(execution.data.validation_results),repositoryApproval=object(validation.repositoryApproval),repositoryWrite=object(validation.repositoryWrite),approvedBy=typeof repositoryApproval.approvedBy==="string"?repositoryApproval.approvedBy:null;
  if(!approvedBy)throw new ApiError("The exact website change has no accountable customer approval.",409,"APPROVAL_REQUIRED");
  const [connection,deployment,checks]=await Promise.all([
    db.from("repository_connections").select("installation_id,repository_owner,repository_name,default_branch").eq("id",execution.data.repository_connection_id).eq("project_id",input.projectId).maybeSingle(),
    db.from("deployments").select("id,status,url,git_sha,validation_summary").eq("id",execution.data.preview_deployment_id).eq("project_id",input.projectId).eq("environment","preview").maybeSingle(),
    db.from("deployment_checks").select("check_type,status,required,score,details").eq("deployment_id",execution.data.preview_deployment_id),
  ]);
  if(!connection.data?.installation_id||!deployment.data?.git_sha||deployment.data.status!=="healthy")throw new ApiError("The independently validated preview is not ready for Autopilot release.",409,"APPROVAL_REQUIRED");
  if(repositoryWrite.commitSha!==deployment.data.git_sha)throw new ApiError("The validated preview commit no longer matches the exact customer-approved change.",409,"INVALID_STATE");
  if(checks.error||(checks.data??[]).some(check=>check.required&&check.status==="failed"))throw new ApiError("A required preview safety check failed. Nothing was released.",409,"PREVIEW_QA_FAILED");
  const required=(checks.data??[]).filter(check=>check.required),action:MutationAction={agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,toolKey:"github.merge",resourceType:"seo_execution",resourceId:input.executionId,environment:"production",payload:{executionId:input.executionId,pullRequestNumber:execution.data.pull_request_number,expectedHeadSha:deployment.data.git_sha,previewDeploymentId:deployment.data.id,previewUrl:deployment.data.url,requiredChecks:required.map(item=>({type:item.check_type,status:item.status,score:item.score})),delegatedFromApprovalDigest:repositoryApproval.actionDigest??null}},digest=mutationDigest(action),intent=await requestMutationIntent(db,{action,summary:"Release the unchanged, customer-approved SEO change after independent preview QA passed.",riskLevel:"high",approvalPolicy:"client_package",requestedBy:approvedBy,idempotencyKey:`autopilot-github-merge:${input.executionId}:${digest}`,expiresInMinutes:24*60}),executionRef=`autopilot-github-merge:${input.executionId}:${deployment.data.git_sha}`;
  await claimMutationIntent(db,{intentId:intent.id,action,executionRef});
  try{
    const merged=await mergeApprovedPullRequest(connection.data as RepositoryConnection,{pullRequestNumber:execution.data.pull_request_number,expectedHeadSha:deployment.data.git_sha}),now=new Date().toISOString(),saved=await db.from("seo_executions").update({status:"merged",merge_commit_sha:merged.sha,merged_at:now,validation_results:{...validation,productionRelease:{mutationIntentId:intent.id,actionDigest:digest,previewDeploymentId:deployment.data.id,approvedBy,approvalPolicy:"client_package",mergedSha:merged.sha,mergedAt:now}}}).eq("id",input.executionId).eq("status","preview_ready").select("id").maybeSingle();
    if(saved.error||!saved.data)throw new ApiError("GitHub merged the approved preview, but HD SEO must reconcile its local release record.",503,"DATABASE_BINDING_FAILED");
    await Promise.all([
      db.from("seo_campaign_jobs").update({status:"awaiting_deployment",current_stage:"release_preview",next_attempt_at:now,error_code:null,error_message:null,updated_at:now}).contains("result",{executionId:input.executionId}),
      db.from("outcome_loop_runs").update({status:"publishing",current_step:"publish",failure_code:null,failure_message:null,updated_at:now}).eq("id",execution.data.outcome_run_id),
      db.from("outcome_loop_steps").update({status:"succeeded",completed_at:now,updated_at:now}).eq("run_id",execution.data.outcome_run_id).eq("step_key","approval"),
      db.from("outcome_loop_steps").update({status:"running",updated_at:now}).eq("run_id",execution.data.outcome_run_id).eq("step_key","publish"),
    ]);
    await settleMutationIntent(db,{intentId:intent.id,executionRef,status:"succeeded"});
    return{released:true,mergeCommitSha:merged.sha};
  }catch(error){
    await settleMutationIntent(db,{intentId:intent.id,executionRef,status:"failed",errorCode:error instanceof ApiError?error.code:"OPERATION_FAILED",errorMessage:error instanceof Error?error.message:"Autopilot release failed."}).catch(()=>undefined);
    throw error;
  }
}
