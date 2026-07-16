import { z } from "zod";
import { resolveTenantContext } from "@/lib/auth/context";
import { jsonError, ApiError } from "@/lib/api/errors";
import { requireAdminDb } from "@/lib/automation/control-plane";

const schema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),deploymentId:z.string().uuid()});
export async function GET(request:Request){try{
  const parsed=schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new ApiError("Deployment query is invalid.",400,"VALIDATION_ERROR");
  const context=await resolveTenantContext({...parsed.data,requireProject:true}),db=requireAdminDb();
  const deployment=await db.from("deployments").select("id,environment,git_ref,git_sha,url,status,external_deployment_id,validation_summary,started_at,ready_at,completed_at,created_at,rollback_of_id,previous_deployment_id").eq("id",parsed.data.deploymentId).eq("agency_id",context.agency.id).eq("project_id",parsed.data.projectId).single();
  if(!deployment.data)throw new ApiError("Deployment not found.",404,"NOT_FOUND");
  const [checks,logs]=await Promise.all([db.from("deployment_checks").select("check_type,status,required,score,details,started_at,completed_at").eq("deployment_id",deployment.data.id).order("check_type"),db.from("deploy_logs").select("sequence,source,level,message,metadata,occurred_at").eq("deployment_id",deployment.data.id).order("occurred_at",{ascending:false}).limit(100)]);
  return Response.json({ok:true,deployment:deployment.data,checks:checks.data??[],logs:(logs.data??[]).reverse()});
}catch(error){return jsonError(error)}}
