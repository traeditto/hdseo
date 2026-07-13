import { resolveTenantContext } from "@/lib/auth/context";
import { jsonError } from "@/lib/api/errors";
import { systemReadiness } from "@/lib/readiness/system-readiness";
export async function GET(request:Request){try{const url=new URL(request.url),context=await resolveTenantContext({agencyId:url.searchParams.get("agencyId")??undefined,clientId:url.searchParams.get("clientId")??undefined,projectId:url.searchParams.get("projectId")??undefined,requireProject:true});return Response.json({ok:true,readiness:await systemReadiness(context.project?.id)});}catch(error){return jsonError(error)}}
