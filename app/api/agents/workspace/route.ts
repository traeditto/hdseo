import { createHash } from "node:crypto";
import { z } from "zod";

import { ApiError,jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { auditEvent,enforceRateLimit } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { agentWorkspaceSnapshot,controlAgentWorkItem,decideAgentApproval,enqueueAgentWorkItem,resumeEvidenceBlockedAgentWork } from "@/lib/agents/control-plane";
import { workTemplates,type AgentWorkType } from "@/lib/agents/registry";
import {requestManagedAgentServiceCycle} from "@/lib/agent-service/service";
import {runManagedAgentCycle} from "@/lib/agent-service/scheduler";
import {decideMutationIntent} from "@/lib/safety/mutation-gateway";

const workTypes=Object.keys(workTemplates) as [AgentWorkType,...AgentWorkType[]];
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("create"),projectId:z.string().uuid(),workType:z.enum(workTypes),goal:z.string().trim().min(10).max(1000).optional(),spendingLimit:z.number().min(0).max(100000).default(0)}),
  z.object({action:z.literal("run_team"),projectId:z.string().uuid()}),
  z.object({action:z.literal("decide"),projectId:z.string().uuid(),approvalId:z.string().uuid(),decision:z.enum(["approved","rejected"]),note:z.string().trim().max(1000).optional()}),
  z.object({action:z.literal("decide_mutation"),projectId:z.string().uuid(),intentId:z.string().uuid(),decision:z.enum(["approved","rejected"])}),
  z.object({action:z.literal("control"),projectId:z.string().uuid(),workItemId:z.string().uuid(),command:z.enum(["cancel","retry"])}),
]);

export async function GET(request:Request){
  try{
    const projectId=new URL(request.url).searchParams.get("projectId");
    if(!projectId||!z.string().uuid().safeParse(projectId).success)throw new ApiError("Choose a client project.",400,"VALIDATION_ERROR");
    const context=await requireLiveAgencyProject({projectId,permission:"seo.read"});
    return Response.json({ok:true,workspace:await agentWorkspaceSnapshot(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId})});
  }catch(error){return jsonError(error);}
}

export async function POST(request:Request){
  try{
    const input=await parseJson(request,schema),permission=input.action==="decide"||input.action==="decide_mutation"?"execution.approve":"seo.write",context=await requireLiveAgencyProject({projectId:input.projectId,permission});
    await enforceRateLimit(`agency:${context.agencyId}:project:${input.projectId}`,`agent_workspace_${input.action}`,input.action==="create"?30:input.action==="run_team"?5:60,3600);
    const tenant={agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,userId:context.userId};let notice:string|undefined;
    if(input.action==="create"){
      const bucket=Math.floor(Date.now()/600_000),goal=input.goal??workTemplates[input.workType].goal,key=createHash("sha256").update(`${input.projectId}:${input.workType}:${goal}:${bucket}`).digest("hex");
      const queued=await enqueueAgentWorkItem(context.db,tenant,{workType:input.workType,goal,spendingLimit:input.spendingLimit,idempotencyKey:`workspace:${key}`,sourceType:"agent_workspace"});
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"agent.work_item.created",resourceType:"agent_work_item",resourceId:queued.workItemId,afterState:{workType:input.workType,goal,spendingLimit:input.spendingLimit},request});
    }else if(input.action==="run_team"){
      const bucket=Math.floor(Date.now()/300_000),managed=await requestManagedAgentServiceCycle(context.db,tenant),resumed=await resumeEvidenceBlockedAgentWork(context.db,{agencyId:context.agencyId,projectId:input.projectId,recoveryKey:`workspace:${bucket}`,allowedTools:managed.allowedTools}),cycle=await runManagedAgentCycle(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,requestedBy:context.userId});
      notice=resumed?`The profit-guarded outcome cycle started and ${resumed} recoverable specialist task${resumed===1?" was":"s were"} safely resumed.`:`The profit-guarded outcome cycle is ${String(cycle.status).replaceAll("_"," ")}. Capacity, provider budgets, and approvals are enforced before work starts.`;
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"agent.team.requested",resourceType:"agent_service_enrollment",resourceId:managed.enrollmentId,afterState:{managedService:true,resumedWorkItems:resumed,toolsUpdated:managed.toolsUpdated,cycle},request});
    }else if(input.action==="decide"){
      await decideAgentApproval(context.db,tenant,input);
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`agent.approval.${input.decision}`,resourceType:"agent_approval",resourceId:input.approvalId,afterState:{note:input.note??null},request});
    }else if(input.action==="decide_mutation"){
      const protectedAction=await context.db.from("mutation_intents").select("tool_key").eq("id",input.intentId).eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",input.projectId).maybeSingle();if(!protectedAction.data)throw new ApiError("Protected action not found.",404,"NOT_FOUND");
      if(["vercel.rollback","cms.rollback"].includes(protectedAction.data.tool_key))await requireLiveAgencyProject({projectId:input.projectId,permission:"deploy.rollback"});
      const intent=await decideMutationIntent(context.db,{intentId:input.intentId,agencyId:context.agencyId,projectId:input.projectId,actorId:context.userId,decision:input.decision});
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`mutation.${input.decision}`,resourceType:"mutation_intent",resourceId:input.intentId,afterState:{actionDigest:intent.action_digest,status:intent.status},request});
    }else{
      await controlAgentWorkItem(context.db,tenant,input);
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`agent.work_item.${input.command}`,resourceType:"agent_work_item",resourceId:input.workItemId,request});
    }
    return Response.json({ok:true,notice,workspace:await agentWorkspaceSnapshot(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId})});
  }catch(error){return jsonError(error);}
}
