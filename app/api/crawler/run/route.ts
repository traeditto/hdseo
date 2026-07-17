import { z } from "zod";
import { parseJson } from "@/lib/api/request";
import { ApiError,jsonError } from "@/lib/api/errors";
import { auditEvent,enforceRateLimit } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { enqueueEvidenceJob } from "@/lib/evidence/queue";

const schema=z.object({projectId:z.string().uuid()});
export async function POST(request:Request){try{const input=await parseJson(request,schema),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"provider.authorize"});await enforceRateLimit(`agency:${context.agencyId}:project:${input.projectId}`,"website_crawl",6,3600);const website=await context.db.from("websites").select("id,status").eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",input.projectId).eq("is_primary",true).limit(1).maybeSingle();if(!website.data)throw new ApiError("Connect the client website before starting a crawl.",409,"WEBSITE_CONNECTION_FAILED");const bucket=new Date().toISOString().slice(0,13),jobId=await enqueueEvidenceJob(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,websiteId:website.data.id,jobType:"crawler.crawl",idempotencyKey:`crawl:${input.projectId}:${bucket}`,priority:80});await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"crawler.run_queued",resourceType:"website",resourceId:website.data.id,afterState:{jobId},request});return Response.json({ok:true,jobId,message:"Safe website crawl queued."},{status:202});}catch(error){return jsonError(error);}}
