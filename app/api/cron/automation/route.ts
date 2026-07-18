import { env } from "@/lib/config/env";
import { processDeploymentBatch } from "@/lib/automation/worker";
import { processAgentBatch } from "@/lib/agents/supervisor";
import { recordSystemHeartbeat } from "@/lib/readiness/heartbeat";

export async function GET(request:Request){
  if(!env.CRON_SECRET||request.headers.get("authorization")!==`Bearer ${env.CRON_SECRET}`)return Response.json({ok:false},{status:401});
  const workerId=`automation-cron:${process.env.VERCEL_REGION??"local"}`;
  await recordSystemHeartbeat({component:"scheduler:automation",status:"healthy",workerId,metadata:{phase:"started"}});
  try{
    const [deployments,agents]=await Promise.all([processDeploymentBatch(),processAgentBatch(env.AUTOMATION_JOB_BATCH_SIZE)]);
    await recordSystemHeartbeat({component:"scheduler:automation",status:"healthy",workerId,metadata:{phase:"completed",deploymentsClaimed:deployments.claimed,agentsClaimed:agents.claimed}});
    return Response.json({ok:true,deployments,agents,timestamp:new Date().toISOString()});
  }catch(error){
    await recordSystemHeartbeat({component:"scheduler:automation",status:"failed",workerId,metadata:{phase:"failed",error:error instanceof Error?error.name:"UnknownError"}});
    return Response.json({ok:false,error:"AUTOMATION_SCHEDULER_FAILED",timestamp:new Date().toISOString()},{status:500});
  }
}
