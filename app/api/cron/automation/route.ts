import { env } from "@/lib/config/env";
import { processDeploymentBatch } from "@/lib/automation/worker";
import { processAgentBatch } from "@/lib/agents/supervisor";
export async function GET(request:Request){if(!env.CRON_SECRET||request.headers.get("authorization")!==`Bearer ${env.CRON_SECRET}`)return Response.json({ok:false},{status:401});const [deployments,agents]=await Promise.all([processDeploymentBatch(),processAgentBatch(env.AUTOMATION_JOB_BATCH_SIZE)]);return Response.json({ok:true,deployments,agents,timestamp:new Date().toISOString()})}
