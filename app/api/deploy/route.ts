import { z } from "zod";
import { resolveTenantContext, requirePermission } from "@/lib/auth/context";
import { parseJson } from "@/lib/api/request";
import { jsonError, ApiError } from "@/lib/api/errors";
import { auditEvent, enforceRateLimit, requireAdminDb } from "@/lib/automation/control-plane";
import { env } from "@/lib/config/env";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),repositoryId:z.string().uuid(),vercelProjectId:z.string().uuid(),environment:z.enum(["preview","staging","production"]).default("preview"),gitRef:z.string().min(1).max(250).optional(),gitSha:z.string().regex(/^[a-f0-9]{7,40}$/i).optional(),priority:z.number().int().min(0).max(100).default(50),idempotencyKey:z.string().min(12).max(200).optional()});

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
  const idempotencyKey=input.idempotencyKey??request.headers.get("idempotency-key")??`deploy:${input.projectId}:${input.environment}:${input.gitSha??input.gitRef??repository.data.default_branch}:${Math.floor(Date.now()/60000)}`;
  const queued=await db.rpc("enqueue_deployment_job",{p_agency_id:context.agency.id,p_client_organization_id:input.clientId,p_project_id:input.projectId,p_repository_id:input.repositoryId,p_vercel_project_id:input.vercelProjectId,p_requested_by:context.user.id,p_environment:input.environment,p_git_ref:input.gitRef??repository.data.default_branch,p_git_sha:input.gitSha??null,p_idempotency_key:idempotencyKey,p_priority:input.priority});
  if(queued.error)throw new ApiError("Deployment could not be queued.",409,"CONFLICT");
  const result=queued.data as {jobId:string;runId:string;deploymentId:string;duplicate:boolean};
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"deployment.queued",resourceType:"deployment",resourceId:result.deploymentId,request,afterState:{environment:input.environment,gitRef:input.gitRef??repository.data.default_branch,gitSha:input.gitSha??null},metadata:{duplicate:result.duplicate}});
  return Response.json({ok:true,...result,statusUrl:`https://hdseo.vercel.app/api/deploy/status?agencyId=${context.agency.id}&clientId=${input.clientId}&projectId=${input.projectId}&deploymentId=${result.deploymentId}`},{status:result.duplicate?200:202});
}catch(error){return jsonError(error)}}
