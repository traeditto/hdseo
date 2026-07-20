import { ApiError,jsonError } from "@/lib/api/errors";
import { auditEvent } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { googleAuthorizationUrl } from "@/lib/google/search-console";
import {appBaseUrl} from "@/lib/config/env";
import {issueIntegrationState} from "@/lib/security/integration-state-ledger";

export async function GET(request:Request){
  try{
    const url=new URL(request.url),projectId=url.searchParams.get("projectId"),requestedReturnUrl=url.searchParams.get("returnUrl"),returnUrl=requestedReturnUrl?.startsWith("/")&&!requestedReturnUrl.startsWith("//")?requestedReturnUrl:"/portal/agency?tab=Websites&gsc=connected";
    if(!projectId)throw new ApiError("Choose a client project before connecting Search Console.",400,"VALIDATION_ERROR");
    const context=await requireLiveAgencyProject({projectId,permission:"integrations.manage"});
    const signed=await issueIntegrationState(context.db,{provider:"google_search_console",callbackHost:new URL("/api/google/callback",appBaseUrl()).host,state:{purpose:"google_search_console",agencyId:context.agencyId,clientId:context.clientId,projectId:context.project.id,returnUrl,userId:context.userId}});
    await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"google.search_console.connect_started",resourceType:"seo_project",resourceId:context.project.id,request});
    return Response.redirect(googleAuthorizationUrl(signed),303);
  }catch(error){return jsonError(error);}
}
