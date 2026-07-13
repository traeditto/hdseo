import { env } from "@/lib/config/env";
import { processCampaignBatch } from "@/lib/jobs/runner";
import { processOneMonitoringCheckpoint } from "@/lib/jobs/monitoring-worker";
export async function GET(request:Request){if(!env.CRON_SECRET||request.headers.get("authorization")!==`Bearer ${env.CRON_SECRET}`)return Response.json({ok:false},{status:401});const jobs=await processCampaignBatch(env.JOB_BATCH_SIZE),checkpoints=[];for(let index=0;index<env.JOB_BATCH_SIZE;index++){const result=await processOneMonitoringCheckpoint(`cron:${crypto.randomUUID()}`);checkpoints.push(result);if(result.status==="idle")break;}return Response.json({ok:true,jobs,checkpoints,timestamp:new Date().toISOString()});}
