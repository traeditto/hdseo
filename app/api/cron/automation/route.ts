import { env } from "@/lib/config/env";
import { processDeploymentBatch } from "@/lib/automation/worker";
export async function GET(request:Request){if(!env.CRON_SECRET||request.headers.get("authorization")!==`Bearer ${env.CRON_SECRET}`)return Response.json({ok:false},{status:401});const result=await processDeploymentBatch();return Response.json({ok:true,...result,timestamp:new Date().toISOString()})}
