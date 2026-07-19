import {z} from "zod";
import {jsonError} from "@/lib/api/errors";
import {parseJson} from "@/lib/api/request";
import {requireLiveAgencyProject} from "@/lib/auth/live-tenant";
import {enforceRateLimit} from "@/lib/automation/control-plane";
import {enrollAgentService,agentServiceSnapshot} from "@/lib/agent-service/service";
import {agentServicePlans} from "@/lib/agent-service/catalog";

const plans=Object.keys(agentServicePlans) as [keyof typeof agentServicePlans,...Array<keyof typeof agentServicePlans>];
const schema=z.object({projectId:z.string().uuid(),serviceMode:z.enum(["platform","copilot","managed_agent"]).default("managed_agent"),planKey:z.enum(plans).default("growth"),approvalOwner:z.enum(["agency","client","both"]).default("client"),operatorBrand:z.enum(["hdseo","agency"]).default("hdseo"),billingOwner:z.enum(["agency","client"]).default("client"),allowedTools:z.array(z.string().min(2).max(100)).max(50).optional(),resalePriceCents:z.number().int().min(0).max(10000000).optional()});
export async function POST(request:Request){try{const input=await parseJson(request,schema),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"clients.manage"});await enforceRateLimit(`agent-service:${context.agencyId}:${input.projectId}`,"enroll",10,3600);const client=context.actorType==="client";await enrollAgentService(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,userId:context.userId},{...input,operatorBrand:client?"hdseo":input.operatorBrand,approvalOwner:client?"client":input.approvalOwner,billingOwner:client?"client":input.billingOwner});return Response.json({ok:true,service:await agentServiceSnapshot(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId})});}catch(error){return jsonError(error);}}
