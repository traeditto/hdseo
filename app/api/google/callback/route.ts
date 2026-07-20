import { ApiError,jsonError,logServerError } from "@/lib/api/errors";
import { appBaseUrl } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";
import { auditEvent } from "@/lib/automation/control-plane";
import { encryptSecret,decryptSecret } from "@/lib/security/encryption";
import { verifyIntegrationState } from "@/lib/security/signed-state";
import { exchangeGoogleCode,googleAccountEmail,listSearchConsoleProperties,propertyMatchesDomain } from "@/lib/google/search-console";
import {consumeIntegrationState} from "@/lib/security/integration-state-ledger";

export async function GET(request:Request){
  const referenceId=crypto.randomUUID();
  try{
    const url=new URL(request.url),code=url.searchParams.get("code"),rawState=url.searchParams.get("state"),providerError=url.searchParams.get("error");
    if(providerError)throw new ApiError("Google authorization was cancelled or denied.",400,"GOOGLE_OAUTH_FAILED",referenceId);
    if(!code||!rawState)throw new ApiError("Google callback is missing its authorization code or state.",400,"INVALID_STATE",referenceId);
    const state=verifyIntegrationState(rawState,"google_search_console");
    if(!state.oauthStateId||!state.clientId||!state.projectId)throw new ApiError("Google connection state is incomplete.",400,"INVALID_STATE",referenceId);
    const db=getLiveAdminClient();await consumeIntegrationState(db,{rawState,state,provider:"google_search_console",callbackHost:url.host});
    const credentials=await exchangeGoogleCode(code);
    if(!credentials.refreshToken){
      const previous=await db.from("integration_connections").select("encrypted_secret_reference").eq("agency_id",state.agencyId).eq("client_organization_id",state.clientId).eq("project_id",state.projectId).eq("provider","google_search_console").maybeSingle();
      if(previous.data?.encrypted_secret_reference)try{credentials.refreshToken=(JSON.parse(decryptSecret(previous.data.encrypted_secret_reference)) as {refreshToken?:string}).refreshToken??"";}catch{/* reconnect below */}
    }
    if(!credentials.refreshToken)throw new ApiError("Google did not issue offline access. Reconnect and approve access again.",409,"GOOGLE_OAUTH_FAILED",referenceId);
    const [properties,email,project]=await Promise.all([listSearchConsoleProperties(credentials.accessToken),googleAccountEmail(credentials.accessToken),db.from("seo_projects").select("id,domain").eq("id",state.projectId).eq("agency_id",state.agencyId).eq("client_organization_id",state.clientId).single()]);
    if(!project.data)throw new ApiError("The selected client project no longer exists.",404,"NOT_FOUND",referenceId);
    const selected=properties.find(property=>propertyMatchesDomain(property.siteUrl,project.data.domain))?.siteUrl??(properties.length===1?properties[0].siteUrl:null),now=new Date().toISOString();
    const saved=await db.from("integration_connections").upsert({agency_id:state.agencyId,client_organization_id:state.clientId,project_id:state.projectId,provider:"google_search_console",connection_type:"oauth",status:"active",external_account_id:email,selected_resource:selected,encrypted_secret_reference:encryptSecret(JSON.stringify(credentials)),scopes:credentials.scope.split(" ").filter(Boolean),last_verified_at:now,metadata:{properties,health:selected?"ready":"property_selection_required",connectedAt:now},updated_at:now},{onConflict:"project_id,provider"}).select("id").single();
    if(saved.error||!saved.data)throw new ApiError("Search Console authorization could not be bound to the client project.",500,"DATABASE_BINDING_FAILED",referenceId);
    await auditEvent({agencyId:state.agencyId,actorUserId:state.userId,action:"google.search_console.connected",resourceType:"integration_connection",resourceId:saved.data.id,afterState:{projectId:state.projectId,selectedProperty:selected,propertyCount:properties.length}});
    const destination=new URL(state.returnUrl??"/portal/agency?tab=Websites&gsc=connected",`${appBaseUrl()}/`);
    if(destination.origin!==appBaseUrl())destination.href=`${appBaseUrl()}/portal/agency?tab=Websites&gsc=connected`;
    return new Response(null,{status:303,headers:{location:destination.toString()}});
  }catch(error){logServerError("google_search_console_callback_failed",error,{referenceId,provider:"google",operation:"oauth_callback"});return jsonError(error);}
}
