import { ApiError,jsonError } from "@/lib/api/errors";
import { auditEvent } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { createIntegrationState } from "@/lib/security/signed-state";
import { encryptSecret } from "@/lib/security/encryption";
import { googleAuthorizationUrl } from "@/lib/google/search-console";

export async function GET(request:Request){
  try{
    const url=new URL(request.url),projectId=url.searchParams.get("projectId"),requestedReturnUrl=url.searchParams.get("returnUrl"),returnUrl=requestedReturnUrl?.startsWith("/")&&!requestedReturnUrl.startsWith("//")?requestedReturnUrl:"/portal/agency?tab=Websites&gsc=connected";
    if(!projectId)throw new ApiError("Choose a client project before connecting Search Console.",400,"VALIDATION_ERROR");
    const context=await requireLiveAgencyProject({projectId,permission:"integrations.manage"}),id=crypto.randomUUID(),nonce=crypto.randomUUID();
    const saved=await context.db.from("integration_oauth_states").insert({id,agency_id:context.agencyId,user_id:context.userId,provider:"google_search_console",encrypted_access_token:encryptSecret(JSON.stringify({nonce})),context:{nonce,clientId:context.clientId,projectId:context.project.id,returnUrl},expires_at:new Date(Date.now()+600_000).toISOString()});
    if(saved.error)throw new ApiError("Search Console connection state could not be saved. Apply migration 0016 and retry.",500,"DATABASE_BINDING_FAILED");
    const signed=createIntegrationState({purpose:"google_search_console",agencyId:context.agencyId,clientId:context.clientId,projectId:context.project.id,returnUrl,userId:context.userId,oauthStateId:id,setupAction:nonce},600);
    await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"google.search_console.connect_started",resourceType:"seo_project",resourceId:context.project.id,request});
    return Response.redirect(googleAuthorizationUrl(signed),303);
  }catch(error){return jsonError(error);}
}
