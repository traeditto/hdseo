import {z} from "zod";

import {parseJson} from "@/lib/api/request";
import {ApiError,jsonError} from "@/lib/api/errors";
import {resolveTenantContext} from "@/lib/auth/context";
import {requireSecureRequestContext} from "@/lib/api/secure-request-context";
import {auditEvent,requireAdminDb} from "@/lib/automation/control-plane";
import {decideMutationIntent,guardedTools,requestMutationIntent,type GuardedTool,type MutationRisk} from "@/lib/safety/mutation-gateway";

const requestSchema=z.object({
  agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),
  toolKey:z.enum(guardedTools),resourceType:z.string().trim().min(1).max(80),resourceId:z.string().trim().max(300).nullable().optional(),
  environment:z.string().trim().max(40).nullable().optional(),summary:z.string().trim().min(8).max(500),
  payload:z.record(z.string(),z.unknown()),idempotencyKey:z.string().trim().min(12).max(200),expiresInMinutes:z.number().int().min(5).max(1440).optional(),
});
const decisionSchema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),intentId:z.string().uuid(),decision:z.enum(["approved","rejected"]),confirmation:z.string().trim().max(40).optional()});

const toolPolicy:Record<GuardedTool,{permission:string;risk:MutationRisk}>={
  "vercel.deploy":{permission:"deploy.create",risk:"high"},"vercel.rollback":{permission:"deploy.rollback",risk:"critical"},
  "cms.publish":{permission:"execution.approve",risk:"high"},"cms.rollback":{permission:"deploy.rollback",risk:"critical"},
  "github.write":{permission:"execution.approve",risk:"high"},"github.merge":{permission:"execution.approve",risk:"high"},
  "authority.outreach":{permission:"execution.approve",risk:"high"},
};

export async function GET(request:Request){try{
  const url=new URL(request.url),context=await resolveTenantContext({agencyId:url.searchParams.get("agencyId")??undefined,clientId:url.searchParams.get("clientId")??undefined,projectId:url.searchParams.get("projectId")??undefined,requireProject:true});
  if(!context.project||!context.client)throw new ApiError("Project access is required.",403,"TENANT_DENIED");
  const db=requireAdminDb(),result=await db.from("mutation_intents").select("id,tool_key,resource_type,resource_id,environment,summary,risk_level,approval_policy,action_digest,status,requested_by,approved_by,expires_at,approved_at,execution_started_at,completed_at,failure_code,created_at").eq("agency_id",context.agency.id).eq("client_organization_id",context.client.id).eq("project_id",context.project.id).order("created_at",{ascending:false}).limit(100);
  if(result.error)throw new ApiError("Protected actions could not be loaded. Apply migration 0030.",503,"DATABASE_BINDING_FAILED");
  return Response.json({ok:true,intents:result.data??[]});
}catch(error){return jsonError(error)}}

export async function POST(request:Request){try{
  const input=await parseJson(request,requestSchema),policy=toolPolicy[input.toolKey],secure=await requireSecureRequestContext(request,{permission:policy.permission,agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true,requireAal2:true}),context=secure.tenantContext;
  if(!context.project||!context.client)throw new ApiError("Project access is required.",403,"TENANT_DENIED");
  if(input.toolKey==="vercel.deploy"&&input.environment==="preview")throw new ApiError("Preview deployments are policy-authorized automatically and do not need a human approval request.",409,"CONFLICT");
  const db=requireAdminDb(),intent=await requestMutationIntent(db,{action:{agencyId:context.agency.id,clientId:context.client.id,projectId:context.project.id,toolKey:input.toolKey,resourceType:input.resourceType,resourceId:input.resourceId,environment:input.environment,payload:input.payload},summary:input.summary,riskLevel:policy.risk,approvalPolicy:"human",requestedBy:context.user.id,idempotencyKey:input.idempotencyKey,expiresInMinutes:input.expiresInMinutes});
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"mutation.approval_requested",resourceType:"mutation_intent",resourceId:intent.id,request,afterState:{toolKey:input.toolKey,actionDigest:intent.action_digest,riskLevel:policy.risk,expiresAt:intent.expires_at}});
  return Response.json({ok:true,intent},{status:intent.status==="awaiting"?202:200});
}catch(error){return jsonError(error)}}

export async function PATCH(request:Request){try{
  const input=await parseJson(request,decisionSchema),secure=await requireSecureRequestContext(request,{permission:"execution.approve",agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true,requireAal2:true}),context=secure.tenantContext;
  if(!context.project||!context.client)throw new ApiError("Project access is required.",403,"TENANT_DENIED");
  const db=requireAdminDb(),intent=await decideMutationIntent(db,{intentId:input.intentId,agencyId:context.agency.id,projectId:context.project.id,actorId:context.user.id,decision:input.decision,confirmation:input.confirmation});
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:`mutation.${input.decision}`,resourceType:"mutation_intent",resourceId:input.intentId,request,afterState:{actionDigest:intent.action_digest,status:intent.status}});
  return Response.json({ok:true,intent});
}catch(error){return jsonError(error)}}
