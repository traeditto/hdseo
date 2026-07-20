import { createHash } from "node:crypto";
import { z } from "zod";

import { ApiError,jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { auditEvent,enforceRateLimit } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { agentWorkspaceSnapshot,controlAgentWorkItem,decideAgentApproval,enqueueAgentWorkItem } from "@/lib/agents/control-plane";
import { workTemplates,type AgentWorkType } from "@/lib/agents/registry";
import {decideMutationIntent} from "@/lib/safety/mutation-gateway";

const workTypes=Object.keys(workTemplates) as [AgentWorkType,...AgentWorkType[]];
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("create"),projectId:z.string().uuid(),workType:z.enum(workTypes),goal:z.string().trim().min(10).max(1000).optional(),spendingLimit:z.number().min(0).max(100000).default(0)}),
  z.object({action:z.literal("run_team"),projectId:z.string().uuid(),spendingLimit:z.number().min(0).max(100000).default(0)}),
  z.object({action:z.literal("decide"),projectId:z.string().uuid(),approvalId:z.string().uuid(),decision:z.enum(["approved","rejected"]),note:z.string().trim().max(1000).optional()}),
  z.object({action:z.literal("decide_mutation"),projectId:z.string().uuid(),intentId:z.string().uuid(),decision:z.enum(["approved","rejected"]),confirmation:z.string().trim().max(40).optional()}),
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
    const tenant={agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,userId:context.userId};
    if(input.action==="create"){
      const bucket=Math.floor(Date.now()/600_000),goal=input.goal??workTemplates[input.workType].goal,key=createHash("sha256").update(`${input.projectId}:${input.workType}:${goal}:${bucket}`).digest("hex");
      const queued=await enqueueAgentWorkItem(context.db,tenant,{workType:input.workType,goal,spendingLimit:input.spendingLimit,idempotencyKey:`workspace:${key}`,sourceType:"agent_workspace"});
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"agent.work_item.created",resourceType:"agent_work_item",resourceId:queued.workItemId,afterState:{workType:input.workType,goal,spendingLimit:input.spendingLimit},request});
    }else if(input.action==="run_team"){
      const runId=crypto.randomUUID(),types:AgentWorkType[]=["onboarding.profile","technical.audit","research.discovery","strategy.roadmap","content.plan","local.plan","reporting.summary"];
      const queued=await Promise.all(types.map(workType=>enqueueAgentWorkItem(context.db,tenant,{workType,spendingLimit:workType==="research.discovery"?input.spendingLimit:0,idempotencyKey:`workspace-team:${runId}:${workType}`,sourceType:"agent_workspace_team",sourceId:runId})));
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"agent.team.started",resourceType:"seo_project",resourceId:input.projectId,afterState:{runId,workItemIds:queued.map(item=>item.workItemId),spendingLimit:input.spendingLimit},request});
    }else if(input.action==="decide"){
      await decideAgentApproval(context.db,tenant,input);
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`agent.approval.${input.decision}`,resourceType:"agent_approval",resourceId:input.approvalId,afterState:{note:input.note??null},request});
    }else if(input.action==="decide_mutation"){
      const protectedAction=await context.db.from("mutation_intents").select("tool_key").eq("id",input.intentId).eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",input.projectId).maybeSingle();if(!protectedAction.data)throw new ApiError("Protected action not found.",404,"NOT_FOUND");
      if(["vercel.rollback","cms.rollback"].includes(protectedAction.data.tool_key))await requireLiveAgencyProject({projectId:input.projectId,permission:"deploy.rollback"});
      const intent=await decideMutationIntent(context.db,{intentId:input.intentId,agencyId:context.agencyId,projectId:input.projectId,actorId:context.userId,decision:input.decision,confirmation:input.confirmation});
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`mutation.${input.decision}`,resourceType:"mutation_intent",resourceId:input.intentId,afterState:{actionDigest:intent.action_digest,status:intent.status},request});
    }else{
      await controlAgentWorkItem(context.db,tenant,input);
      await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`agent.work_item.${input.command}`,resourceType:"agent_work_item",resourceId:input.workItemId,request});
    }
    return Response.json({ok:true,workspace:await agentWorkspaceSnapshot(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId})});
  }catch(error){return jsonError(error);}
}
