import { env } from "@/lib/config/env";
import { processCampaignBatch } from "@/lib/jobs/runner";
import { processOneMonitoringCheckpoint } from "@/lib/jobs/monitoring-worker";
import { processEvidenceBatch } from "@/lib/evidence/worker";
import { recordSystemHeartbeat } from "@/lib/readiness/heartbeat";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scheduleDueEvidence } from "@/lib/evidence/scheduler";

export async function GET(request:Request){
  if(!env.CRON_SECRET||request.headers.get("authorization")!==`Bearer ${env.CRON_SECRET}`)return Response.json({ok:false},{status:401});
  const workerId=`seo-cron:${process.env.VERCEL_REGION??"local"}`;
  await recordSystemHeartbeat({component:"scheduler:seo",status:"healthy",workerId,metadata:{phase:"started"}});
  try{
    let evidence:{claimed?:number;results?:unknown[];error?:unknown};
    const db=createSupabaseAdminClient();
    const scheduling=db?await scheduleDueEvidence(db,workerId,Math.max(10,env.AUTOMATION_JOB_BATCH_SIZE*2)):{claimed:0,recovery:{},results:[]};
    try{evidence=await processEvidenceBatch(env.AUTOMATION_JOB_BATCH_SIZE);}catch(error){evidence={error:error instanceof Error?error.message:"Evidence worker unavailable"};}
    const jobs=await processCampaignBatch(env.JOB_BATCH_SIZE),checkpoints=[];
    for(let index=0;index<env.JOB_BATCH_SIZE;index++){const result=await processOneMonitoringCheckpoint(`cron:${crypto.randomUUID()}`);checkpoints.push(result);if(result.status==="idle")break;}
    const degraded=Boolean(evidence.error);
    await recordSystemHeartbeat({component:"scheduler:seo",status:degraded?"degraded":"healthy",workerId,metadata:{phase:"completed",policiesClaimed:scheduling.claimed,evidenceClaimed:evidence.claimed??0,campaignClaimed:Array.isArray(jobs)?jobs.length:0,monitoringProcessed:checkpoints.filter(item=>item.status!=="idle").length}});
    return Response.json({ok:!degraded,scheduling,evidence,jobs,checkpoints,timestamp:new Date().toISOString()},{status:degraded?207:200});
  }catch(error){
    await recordSystemHeartbeat({component:"scheduler:seo",status:"failed",workerId,metadata:{phase:"failed",error:error instanceof Error?error.name:"UnknownError"}});
    return Response.json({ok:false,error:"SEO_SCHEDULER_FAILED",timestamp:new Date().toISOString()},{status:500});
  }
}
