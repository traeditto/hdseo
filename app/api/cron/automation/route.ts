import { env } from "@/lib/config/env";
import { guardWorkerCron } from "@/lib/cron/runtime";
import { processDeploymentBatch } from "@/lib/automation/worker";
import { processAgentBatch } from "@/lib/agents/supervisor";
import { recordSystemHeartbeat } from "@/lib/readiness/heartbeat";
import { syncOutcomeProviders } from "@/lib/outcomes/worker";

export async function GET(request:Request){
  const guarded=guardWorkerCron(request);if(guarded)return guarded;
  const workerId=`automation-cron:${process.env.VERCEL_REGION??"local"}`;
  await recordSystemHeartbeat({component:"scheduler:automation",status:"healthy",workerId,metadata:{phase:"started"}});
  try{
    const [deployments,agents,outcomes]=await Promise.all([processDeploymentBatch(),processAgentBatch(env.AUTOMATION_JOB_BATCH_SIZE),syncOutcomeProviders()]);
    await recordSystemHeartbeat({component:"scheduler:automation",status:"healthy",workerId,metadata:{phase:"completed",deploymentsClaimed:deployments.claimed,agentsClaimed:agents.claimed,outcomesClaimed:outcomes.claimed}});
    return Response.json({ok:true,deployments,agents,outcomes,timestamp:new Date().toISOString()});
  }catch(error){
    await recordSystemHeartbeat({component:"scheduler:automation",status:"failed",workerId,metadata:{phase:"failed",error:error instanceof Error?error.name:"UnknownError"}});
    return Response.json({ok:false,error:"AUTOMATION_SCHEDULER_FAILED",timestamp:new Date().toISOString()},{status:500});
  }
}
