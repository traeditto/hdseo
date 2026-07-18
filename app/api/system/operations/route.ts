import { z } from "zod";

import { resolvePortalAccess } from "@/lib/auth/portal-access";
import { parseJson } from "@/lib/api/request";
import { ApiError,jsonError,logEvent } from "@/lib/api/errors";
import { enforceRateLimit,requireAdminDb } from "@/lib/automation/control-plane";
import { processDeploymentBatch } from "@/lib/automation/worker";
import { processAgentBatch } from "@/lib/agents/supervisor";
import { env } from "@/lib/config/env";
import { processEvidenceBatch } from "@/lib/evidence/worker";
import { processCampaignBatch } from "@/lib/jobs/runner";
import { processOneMonitoringCheckpoint } from "@/lib/jobs/monitoring-worker";
import { recordSystemHeartbeat } from "@/lib/readiness/heartbeat";
import { evaluateProductionAcceptance } from "@/lib/readiness/production-acceptance";

export const maxDuration=60;
const schema=z.discriminatedUnion("action",[
  z.object({action:z.enum(["run_seo","run_automation"])}),
  z.object({action:z.literal("start_acceptance"),projectId:z.string().uuid()}),
]);

export async function POST(request:Request){
  let operation:"run_seo"|"run_automation"|"start_acceptance"|null=null,workerId=`manual:unknown:${crypto.randomUUID()}`;
  try{
    const admin=await resolvePortalAccess("admin");
    if(!admin)throw new ApiError("Platform administrator access is required.",403,"ROLE_FORBIDDEN");
    const input=await parseJson(request,schema);operation=input.action;
    await enforceRateLimit(`platform-admin:${admin.userId}`,input.action,6,300);
    const started=Date.now();workerId=`manual:${admin.userId}:${crypto.randomUUID()}`;
    if(input.action==="start_acceptance"){
      const db=requireAdminDb(),project=await db.from("seo_projects").select("id,agency_id,client_organization_id").eq("id",input.projectId).eq("status","active").maybeSingle();
      if(!project.data)throw new ApiError("Active SEO project not found.",404,"NOT_FOUND");
      const acceptance=await evaluateProductionAcceptance(db,{agencyId:project.data.agency_id,clientId:project.data.client_organization_id,projectId:project.data.id,initiatedBy:admin.userId,environment:"production",releaseSha:process.env.VERCEL_GIT_COMMIT_SHA??null});
      logEvent("production_acceptance_evaluated",{projectId:project.data.id,status:acceptance.status,durationMs:Date.now()-started});
      return Response.json({ok:acceptance.status==="succeeded",acceptance},{status:acceptance.status==="succeeded"?200:409});
    }
    if(input.action==="run_seo"){
      await recordSystemHeartbeat({component:"scheduler:seo",status:"healthy",workerId,metadata:{phase:"manual_started"}});
      const evidence=await processEvidenceBatch(env.AUTOMATION_JOB_BATCH_SIZE),campaigns=await processCampaignBatch(env.JOB_BATCH_SIZE),monitoring=[];
      for(let index=0;index<env.JOB_BATCH_SIZE;index++){const item=await processOneMonitoringCheckpoint(workerId);monitoring.push(item);if(item.status==="idle")break;}
      await recordSystemHeartbeat({component:"scheduler:seo",status:"healthy",workerId,metadata:{phase:"manual_completed",durationMs:Date.now()-started,evidenceClaimed:evidence.claimed,campaignStages:campaigns.length,monitoringStages:monitoring.length}});
      logEvent("platform_worker_run",{operation:input.action,status:"succeeded",durationMs:Date.now()-started});
      return Response.json({ok:true,evidence,campaigns,monitoring});
    }
    await recordSystemHeartbeat({component:"scheduler:automation",status:"healthy",workerId,metadata:{phase:"manual_started"}});
    const [deployments,agents]=await Promise.all([processDeploymentBatch(),processAgentBatch(env.AUTOMATION_JOB_BATCH_SIZE)]);
    await recordSystemHeartbeat({component:"scheduler:automation",status:"healthy",workerId,metadata:{phase:"manual_completed",durationMs:Date.now()-started,deploymentsClaimed:deployments.claimed,agentsClaimed:agents.claimed}});
    logEvent("platform_worker_run",{operation:input.action,status:"succeeded",durationMs:Date.now()-started});
    return Response.json({ok:true,deployments,agents});
  }catch(error){if(operation==="run_seo"||operation==="run_automation")await recordSystemHeartbeat({component:operation==="run_seo"?"scheduler:seo":"scheduler:automation",status:"failed",workerId,metadata:{phase:"manual_failed",error:error instanceof Error?error.name:"UnknownError"}});return jsonError(error)}
}
