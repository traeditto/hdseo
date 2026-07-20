import { z } from "zod";
import { parseJson } from "@/lib/api/request";
import { ApiError,jsonError } from "@/lib/api/errors";
import { auditEvent,enforceRateLimit } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { enqueueEvidenceJob } from "@/lib/evidence/queue";
import {claimWebsiteCrawlAccess,markTrialCrawlQueued,releaseTrialCrawlClaim} from "@/lib/trials/crawl-entitlement";

const schema=z.object({projectId:z.string().uuid()});
export async function POST(request:Request){
  try{
    const input=await parseJson(request,schema),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"provider.authorize"});
    await enforceRateLimit(`agency:${context.agencyId}:project:${input.projectId}`,"website_crawl",6,3600);
    const website=await context.db.from("websites").select("id,status").eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",input.projectId).eq("is_primary",true).limit(1).maybeSingle();
    if(!website.data)throw new ApiError("Connect the client website before starting a crawl.",409,"WEBSITE_CONNECTION_FAILED");
    const paidBucket=new Date().toISOString().slice(0,13),trialKey=`trial-crawl:${input.projectId}`;
    const access=await claimWebsiteCrawlAccess(context.db,{projectId:input.projectId,idempotencyKey:trialKey});
    const idempotencyKey=access.mode==="trial"?trialKey:`crawl:${input.projectId}:${paidBucket}`;
    let jobId:string;
    try{
      jobId=await enqueueEvidenceJob(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,websiteId:website.data.id,jobType:"crawler.crawl",payload:access.mode==="trial"?{maxPages:25,trial:true}:{},idempotencyKey,priority:80});
    }catch(error){
      await releaseTrialCrawlClaim(context.db,access,"QUEUE_FAILED");
      throw error;
    }
    await markTrialCrawlQueued(context.db,access,jobId);
    await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:access.mode==="trial"?"trial.crawl_queued":"crawler.run_queued",resourceType:"website",resourceId:website.data.id,afterState:{jobId,crawlMode:access.mode,maxPages:access.mode==="trial"?25:null},request});
    return Response.json({ok:true,jobId,trial:access.mode==="trial",message:access.mode==="trial"?"Your included 25-page website crawl is queued.":"Safe website crawl queued."},{status:202});
  }catch(error){return jsonError(error);}
}
