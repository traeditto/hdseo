import { z } from "zod";
import { resolveTenantContext,requirePermission } from "@/lib/auth/context";
import { parseJson } from "@/lib/api/request";
import { jsonError,ApiError } from "@/lib/api/errors";
import { auditEvent,enforceRateLimit,requireAdminDb } from "@/lib/automation/control-plane";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),sourceDeploymentId:z.string().uuid(),targetDeploymentId:z.string().uuid(),idempotencyKey:z.string().min(12).max(200).optional()});
export async function POST(request:Request){try{
  const input=await parseJson(request,schema),context=await resolveTenantContext({agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true});requirePermission(context,"deploy.rollback");
  await enforceRateLimit(`${context.agency.id}:${context.user.id}`,"deploy.rollback",5,300);
  const db=requireAdminDb(),idempotencyKey=input.idempotencyKey??request.headers.get("idempotency-key")??`rollback:${input.sourceDeploymentId}:${input.targetDeploymentId}`;
  const queued=await db.rpc("enqueue_rollback_job",{p_agency_id:context.agency.id,p_source_deployment_id:input.sourceDeploymentId,p_target_deployment_id:input.targetDeploymentId,p_requested_by:context.user.id,p_idempotency_key:idempotencyKey});
  if(queued.error)throw new ApiError("Rollback target is invalid or could not be queued.",409,"CONFLICT");
  const result=queued.data as {jobId:string;runId:string;deploymentId:string;duplicate:boolean};
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"deployment.rollback_queued",resourceType:"deployment",resourceId:result.deploymentId,request,afterState:{sourceDeploymentId:input.sourceDeploymentId,targetDeploymentId:input.targetDeploymentId}});
  return Response.json({ok:true,...result},{status:result.duplicate?200:202});
}catch(error){return jsonError(error)}}
