import { z } from "zod";
import { resolveTenantContext, requirePermission } from "@/lib/auth/context";
import { parseJson } from "@/lib/api/request";
import { jsonError, ApiError } from "@/lib/api/errors";
import { auditEvent, enforceRateLimit, requireAdminDb } from "@/lib/automation/control-plane";
import { env } from "@/lib/config/env";
import {assertMutationApproved,requestMutationIntent,type MutationAction} from "@/lib/safety/mutation-gateway";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),repositoryId:z.string().uuid(),vercelProjectId:z.string().uuid(),environment:z.enum(["preview","staging","production"]).default("preview"),gitRef:z.string().min(1).max(250).optional(),gitSha:z.string().regex(/^[a-f0-9]{7,40}$/i).optional(),priority:z.number().int().min(0).max(100).default(50),idempotencyKey:z.string().min(12).max(200).optional(),mutationIntentId:z.string().uuid().optional()});

export async function POST(request:Request){try{
  const input=await parseJson(request,schema),context=await resolveTenantContext({agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true});requirePermission(context,"deploy.create");
  await enforceRateLimit(`${context.agency.id}:${context.user.id}`,"deploy.create",20,60);
  const db=requireAdminDb(),active=await db.from("background_jobs").select("id",{count:"exact",head:true}).eq("agency_id",context.agency.id).in("status",["queued","running","retry_scheduled"]);
  if((active.count??0)>=env.AUTOMATION_MAX_CONCURRENT_PER_AGENCY)throw new ApiError("This agency has reached its concurrent deployment limit.",429,"RATE_LIMITED");
  const repository=await db.from("repositories").select("default_branch,repository_execution_enabled").eq("id",input.repositoryId).eq("agency_id",context.agency.id).eq("project_id",input.projectId).single();
  if(!repository.data)throw new ApiError("Repository not found.",404,"NOT_FOUND");
  const readiness=await db.rpc("github_execution_readiness",{target_agency:context.agency.id,target_project:input.projectId});
  const ready=readiness.data as {ready?:boolean;blockers?:string[]} | null;
  if(!repository.data.repository_execution_enabled||!ready?.ready)throw new ApiError(`Repository execution is not ready${ready?.blockers?.length?`: ${ready.blockers.join(", ")}`:"."}`,409,"CONFLICT");
  const gitRef=input.gitRef??repository.data.default_branch,idempotencyKey=input.idempotencyKey??request.headers.get("idempotency-key")??`deploy:${input.projectId}:${input.environment}:${input.gitSha??gitRef}`;
  const action:MutationAction={agencyId:context.agency.id,clientId:input.clientId,projectId:input.projectId,toolKey:"vercel.deploy",resourceType:"vercel_project",resourceId:input.vercelProjectId,environment:input.environment,payload:{repositoryId:input.repositoryId,vercelProjectId:input.vercelProjectId,environment:input.environment,gitRef,gitSha:input.gitSha??null}};
  const intent=input.environment==="preview"
    ?await requestMutationIntent(db,{action,summary:"Create a reversible Vercel preview for independent QA.",riskLevel:"low",approvalPolicy:"rbac_auto",requestedBy:context.user.id,idempotencyKey:`mutation:${idempotencyKey}`})
    :input.mutationIntentId
      ?await assertMutationApproved(db,{intentId:input.mutationIntentId,action})
      :await requestMutationIntent(db,{action,summary:`Deploy the exact approved ${gitRef} revision to ${input.environment}.`,riskLevel:"high",approvalPolicy:"human",requestedBy:context.user.id,idempotencyKey:`mutation:${idempotencyKey}`,expiresInMinutes:60});
  if(["rejected","cancelled"].includes(intent.status))throw new ApiError("This exact deployment request was rejected. Change the request and submit a new idempotency key.",409,"APPROVAL_REQUIRED");
  if(input.environment!=="preview"&&!['approved','executing','succeeded'].includes(intent.status)){
    await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"mutation.approval_requested",resourceType:"mutation_intent",resourceId:intent.id,request,afterState:{environment:input.environment,gitRef,gitSha:input.gitSha??null,actionDigest:intent.action_digest,status:intent.status},traceId:intent.trace_id});
    return Response.json({ok:true,approvalRequired:true,intent:{id:intent.id,status:intent.status,actionDigest:intent.action_digest,expiresAt:intent.expires_at},message:"Approve this exact deployment in the Agent Workspace, then submit the same deployment request again."},{status:202});
  }
  const queued=await db.rpc("enqueue_deployment_job",{p_agency_id:context.agency.id,p_client_organization_id:input.clientId,p_project_id:input.projectId,p_repository_id:input.repositoryId,p_vercel_project_id:input.vercelProjectId,p_requested_by:context.user.id,p_environment:input.environment,p_git_ref:input.gitRef??repository.data.default_branch,p_git_sha:input.gitSha??null,p_idempotency_key:idempotencyKey,p_priority:input.priority});
  if(queued.error)throw new ApiError("Deployment could not be queued.",409,"CONFLICT");
  const result=queued.data as {jobId:string;runId:string;deploymentId:string;duplicate:boolean};
  const safety={mutationIntentId:intent.id,actionDigest:intent.action_digest,traceId:intent.trace_id,approvalPolicy:intent.approval_policy};
  const [deploymentBound,jobBound]=await Promise.all([db.from("deployments").update({provider_metadata:{safety},updated_at:new Date().toISOString()}).eq("id",result.deploymentId).eq("agency_id",context.agency.id),db.from("background_jobs").update({payload:{safety},updated_at:new Date().toISOString()}).eq("automation_run_id",result.runId).eq("deployment_id",result.deploymentId).eq("job_type","deployment.create")]);
  if(deploymentBound.error||jobBound.error)throw new ApiError("The deployment safety authorization could not be bound.",500,"DATABASE_BINDING_FAILED");
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"deployment.queued",resourceType:"deployment",resourceId:result.deploymentId,request,afterState:{environment:input.environment,gitRef,gitSha:input.gitSha??null,actionDigest:intent.action_digest},traceId:intent.trace_id,metadata:{duplicate:result.duplicate}});
  return Response.json({ok:true,...result,statusUrl:`https://hdseo.vercel.app/api/deploy/status?agencyId=${context.agency.id}&clientId=${input.clientId}&projectId=${input.projectId}&deploymentId=${result.deploymentId}`},{status:result.duplicate?200:202});
}catch(error){return jsonError(error)}}
