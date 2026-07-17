import { z } from "zod";
import { parseJson } from "@/lib/api/request";
import { jsonError } from "@/lib/api/errors";
import { enforceRateLimit,auditEvent } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { loadGoogleConnection } from "@/lib/google/connection";
import { enqueueEvidenceJob } from "@/lib/evidence/queue";

const schema=z.object({projectId:z.string().uuid()});
export async function POST(request:Request){try{const input=await parseJson(request,schema),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"provider.authorize"});await enforceRateLimit(`agency:${context.agencyId}:project:${input.projectId}`,"google_sync",6,3600);const connection=await loadGoogleConnection(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId}),bucket=new Date().toISOString().slice(0,13),jobs=await Promise.all([
enqueueEvidenceJob(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,connectionId:connection.id,jobType:"google.search_analytics",idempotencyKey:`gsc-analytics:${input.projectId}:${bucket}`,priority:80}),
enqueueEvidenceJob(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,connectionId:connection.id,jobType:"google.sitemaps",idempotencyKey:`gsc-sitemaps:${input.projectId}:${bucket}`,priority:70}),
enqueueEvidenceJob(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,connectionId:connection.id,jobType:"google.url_inspection",idempotencyKey:`gsc-inspection:${input.projectId}:${bucket}`,priority:60}),
]);await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"google.search_console.sync_queued",resourceType:"seo_project",resourceId:input.projectId,afterState:{jobIds:jobs},request});return Response.json({ok:true,jobIds:jobs,message:"Search Console evidence refresh queued."},{status:202});}catch(error){return jsonError(error);}}
