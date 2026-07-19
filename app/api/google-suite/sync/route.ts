import { z } from "zod";
import { ApiError,jsonError } from "@/lib/api/errors";
import { auditEvent,enforceRateLimit } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { syncAnalytics,syncBusinessProfile } from "@/lib/google/suite";

const schema=z.object({projectId:z.string().uuid(),provider:z.enum(["google_analytics","google_business_profile"])});
export async function POST(request:Request){try{const input=schema.parse(await request.json()),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"provider.authorize"});await enforceRateLimit(`google-sync:${context.agencyId}:${context.project.id}`,input.provider,10,300);const tenant={agencyId:context.agencyId,clientId:context.clientId,projectId:context.project.id},result=input.provider==="google_analytics"?await syncAnalytics(context.db,tenant):await syncBusinessProfile(context.db,tenant);await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`${input.provider}.synced`,resourceType:"seo_project",resourceId:context.project.id,afterState:result,request});return Response.json({ok:true,result});}catch(error){if(error instanceof z.ZodError)return jsonError(new ApiError(error.issues[0]?.message??"Invalid sync request.",400,"VALIDATION_ERROR"));return jsonError(error)}}
