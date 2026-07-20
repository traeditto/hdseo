import { z } from "zod";
import { resolveTenantContext,requirePermission } from "@/lib/auth/context";
import { parseJson } from "@/lib/api/request";
import { jsonError,ApiError } from "@/lib/api/errors";
import { auditEvent,enforceRateLimit,requireAdminDb } from "@/lib/automation/control-plane";
import {assertMutationApproved,requestMutationIntent,type MutationAction} from "@/lib/safety/mutation-gateway";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),sourceDeploymentId:z.string().uuid(),targetDeploymentId:z.string().uuid(),idempotencyKey:z.string().min(12).max(200).optional(),mutationIntentId:z.string().uuid().optional()});
export async function POST(request:Request){try{
  const input=await parseJson(request,schema),context=await resolveTenantContext({agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true});requirePermission(context,"deploy.rollback");
  await enforceRateLimit(`${context.agency.id}:${context.user.id}`,"deploy.rollback",5,300);
  const db=requireAdminDb(),idempotencyKey=input.idempotencyKey??request.headers.get("idempotency-key")??`rollback:${input.sourceDeploymentId}:${input.targetDeploymentId}`;
  const action:MutationAction={agencyId:context.agency.id,clientId:input.clientId,projectId:input.projectId,toolKey:"vercel.rollback",resourceType:"deployment",resourceId:input.sourceDeploymentId,environment:"production",payload:{sourceDeploymentId:input.sourceDeploymentId,targetDeploymentId:input.targetDeploymentId}};
  const intent=input.mutationIntentId?await assertMutationApproved(db,{intentId:input.mutationIntentId,action}):await requestMutationIntent(db,{action,summary:"Restore production to the exact selected healthy deployment.",riskLevel:"critical",approvalPolicy:"human",requestedBy:context.user.id,idempotencyKey:`mutation:${idempotencyKey}`,expiresInMinutes:60});
  if(["rejected","cancelled"].includes(intent.status))throw new ApiError("This exact rollback request was rejected. Submit a new request only if the recovery plan changes.",409,"APPROVAL_REQUIRED");
  if(!["approved","executing","succeeded"].includes(intent.status)){
    await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"mutation.approval_requested",resourceType:"mutation_intent",resourceId:intent.id,request,afterState:{sourceDeploymentId:input.sourceDeploymentId,targetDeploymentId:input.targetDeploymentId,actionDigest:intent.action_digest,status:intent.status},traceId:intent.trace_id});
    return Response.json({ok:true,approvalRequired:true,intent:{id:intent.id,status:intent.status,actionDigest:intent.action_digest,expiresAt:intent.expires_at},message:"Approve this exact rollback in the Agent Workspace, then submit the same rollback request again."},{status:202});
  }
  const queued=await db.rpc("enqueue_rollback_job",{p_agency_id:context.agency.id,p_source_deployment_id:input.sourceDeploymentId,p_target_deployment_id:input.targetDeploymentId,p_requested_by:context.user.id,p_idempotency_key:idempotencyKey});
  if(queued.error)throw new ApiError("Rollback target is invalid or could not be queued.",409,"CONFLICT");
  const result=queued.data as {jobId:string;runId:string;deploymentId:string;duplicate:boolean};
  const safety={mutationIntentId:intent.id,actionDigest:intent.action_digest,traceId:intent.trace_id,approvalPolicy:intent.approval_policy};
  const [deploymentBound,jobBound]=await Promise.all([db.from("deployments").update({provider_metadata:{safety},updated_at:new Date().toISOString()}).eq("id",result.deploymentId).eq("agency_id",context.agency.id),db.from("background_jobs").update({payload:{sourceDeploymentId:input.sourceDeploymentId,targetDeploymentId:input.targetDeploymentId,safety},updated_at:new Date().toISOString()}).eq("automation_run_id",result.runId).eq("deployment_id",result.deploymentId).eq("job_type","deployment.rollback")]);
  if(deploymentBound.error||jobBound.error)throw new ApiError("The rollback safety authorization could not be bound.",500,"DATABASE_BINDING_FAILED");
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"deployment.rollback_queued",resourceType:"deployment",resourceId:result.deploymentId,request,afterState:{sourceDeploymentId:input.sourceDeploymentId,targetDeploymentId:input.targetDeploymentId,actionDigest:intent.action_digest},traceId:intent.trace_id});
  return Response.json({ok:true,...result},{status:result.duplicate?200:202});
}catch(error){return jsonError(error)}}
