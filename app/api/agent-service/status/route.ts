import {z} from "zod";
import {ApiError,jsonError} from "@/lib/api/errors";
import {requireLiveAgencyProject} from "@/lib/auth/live-tenant";
import {agentServiceSnapshot} from "@/lib/agent-service/service";

export async function GET(request:Request){try{const projectId=new URL(request.url).searchParams.get("projectId");if(!projectId||!z.string().uuid().safeParse(projectId).success)throw new ApiError("Choose a client project.",400,"VALIDATION_ERROR");const context=await requireLiveAgencyProject({projectId});return Response.json({ok:true,actorType:context.actorType,service:await agentServiceSnapshot(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId})});}catch(error){return jsonError(error);}}
