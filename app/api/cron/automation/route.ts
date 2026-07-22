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
    const settled=await Promise.allSettled([processDeploymentBatch(),processAgentBatch(env.AUTOMATION_JOB_BATCH_SIZE),syncOutcomeProviders()]),names=["deployments","agents","outcomes"] as const,workers=Object.fromEntries(settled.map((result,index)=>[names[index],result.status==="fulfilled"?{ok:true,result:result.value}:{ok:false,errorCode:result.reason instanceof Error?result.reason.name:"WORKER_FAILED"}])),deployments=settled[0].status==="fulfilled"?settled[0].value:null,agents=settled[1].status==="fulfilled"?settled[1].value:null,outcomes=settled[2].status==="fulfilled"?settled[2].value:null,reconciliationFailed=deployments?.reconciliation&&typeof deployments.reconciliation==="object"&&deployments.reconciliation.ok===false,failures=[...settled.flatMap((result,index)=>result.status==="rejected"?[names[index]]:[]),...(reconciliationFailed?["deployment_reconciliation" as const]:[]),...(outcomes?.failed||outcomes?.error?["outcomes" as const]:[])].filter((item,index,all)=>all.indexOf(item)===index);
    await recordSystemHeartbeat({component:"scheduler:automation",status:failures.length?"degraded":"healthy",workerId,metadata:{phase:failures.length?"partial":"completed",failures,deploymentsClaimed:deployments?.claimed??0,agentsClaimed:agents?.claimed??0,outcomesClaimed:outcomes?.claimed??0,outcomesFailed:outcomes?.failed??0,outcomesDeferred:outcomes?.deferred??0}});
    return Response.json({ok:failures.length===0,workers,failures,timestamp:new Date().toISOString()},{status:failures.length?207:200});
  }catch(error){
    await recordSystemHeartbeat({component:"scheduler:automation",status:"failed",workerId,metadata:{phase:"failed",error:error instanceof Error?error.name:"UnknownError"}});
    return Response.json({ok:false,error:"AUTOMATION_SCHEDULER_FAILED",timestamp:new Date().toISOString()},{status:500});
  }
}
