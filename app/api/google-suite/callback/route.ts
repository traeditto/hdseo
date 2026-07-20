import { ApiError,jsonError,logServerError } from "@/lib/api/errors";
import { appBaseUrl,googleSuiteCallbackUrl } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";
import { auditEvent } from "@/lib/automation/control-plane";
import { encryptSecret,decryptSecret } from "@/lib/security/encryption";
import { integrationStatePurpose,verifyIntegrationState } from "@/lib/security/signed-state";
import { exchangeGoogleCode,googleAccountEmail } from "@/lib/google/search-console";
import { listAnalyticsProperties,listBusinessAccounts,listBusinessLocations } from "@/lib/google/suite";
import {consumeIntegrationState} from "@/lib/security/integration-state-ledger";

export async function GET(request:Request){
  const referenceId=crypto.randomUUID();
  try{
    const url=new URL(request.url),code=url.searchParams.get("code"),rawState=url.searchParams.get("state"),providerError=url.searchParams.get("error");
    if(providerError)throw new ApiError("Google authorization was cancelled or denied.",400,"GOOGLE_OAUTH_FAILED",referenceId);
    if(!code||!rawState)throw new ApiError("Google callback is missing its authorization code or state.",400,"INVALID_STATE",referenceId);
    const purpose=integrationStatePurpose(rawState);
    if(purpose!=="google_analytics"&&purpose!=="google_business_profile")throw new ApiError("Google integration state is invalid.",400,"INVALID_STATE",referenceId);
    const state=verifyIntegrationState(rawState,purpose);
    if(!state.oauthStateId||!state.clientId||!state.projectId)throw new ApiError("Google integration state is incomplete.",400,"INVALID_STATE",referenceId);
    const db=getLiveAdminClient();await consumeIntegrationState(db,{rawState,state,provider:purpose,callbackHost:url.host});
    const credentials=await exchangeGoogleCode(code,googleSuiteCallbackUrl());
    if(!credentials.refreshToken){const previous=await db.from("integration_connections").select("encrypted_secret_reference").eq("project_id",state.projectId).eq("provider",purpose).maybeSingle();if(previous.data?.encrypted_secret_reference)try{credentials.refreshToken=(JSON.parse(decryptSecret(previous.data.encrypted_secret_reference)) as {refreshToken?:string}).refreshToken??"";}catch{}}
    if(!credentials.refreshToken)throw new ApiError("Google did not issue offline access. Reconnect and approve access again.",409,"GOOGLE_OAUTH_FAILED",referenceId);
    const email=await googleAccountEmail(credentials.accessToken),now=new Date().toISOString();let selected:string|null=null,metadata:Record<string,unknown>={connectedAt:now,health:"selection_required"},discoveryDeferred=false;
    try{
      if(purpose==="google_analytics"){
        const properties=await listAnalyticsProperties(credentials.accessToken);selected=properties.length===1?properties[0].property:null;metadata={...metadata,properties,health:selected?"ready":"property_selection_required"};
      }else{
        const accounts=await listBusinessAccounts(credentials.accessToken),locations=(await Promise.all(accounts.slice(0,20).map(async account=>(await listBusinessLocations(credentials.accessToken,account.name!)).map(item=>({raw:item,account:account.name,accountName:account.accountName}))))).flat(),selectedAccount=locations.length===1?String(locations[0].account):accounts.length===1?accounts[0].name:null;
        selected=locations.length===1?String(locations[0].raw.name??""):null;metadata={...metadata,accounts,selectedAccount,locations:locations.map(item=>({name:item.raw.name,title:item.raw.title,account:item.account,accountName:item.accountName})),health:selected?"ready":"location_selection_required"};
      }
    }catch(error){
      if(!(error instanceof ApiError)||error.status!==503)throw error;
      discoveryDeferred=true;metadata={...metadata,health:"discovery_pending",discoveryDeferredAt:now};
      logServerError("google_suite_discovery_deferred",error,{referenceId,agencyId:state.agencyId,clientId:state.clientId,projectId:state.projectId,provider:purpose,operation:"resource_discovery"});
    }
    const saved=await db.from("integration_connections").upsert({agency_id:state.agencyId,client_organization_id:state.clientId,project_id:state.projectId,provider:purpose,connection_type:"oauth",status:"active",external_account_id:email,selected_resource:selected,encrypted_secret_reference:encryptSecret(JSON.stringify(credentials)),scopes:credentials.scope.split(" ").filter(Boolean),last_verified_at:now,metadata,updated_at:now},{onConflict:"project_id,provider"}).select("id").single();
    if(saved.error||!saved.data)throw new ApiError("Google authorization could not be bound to this client project.",500,"DATABASE_BINDING_FAILED",referenceId);
    await auditEvent({agencyId:state.agencyId,actorUserId:state.userId,action:`${purpose}.connected`,resourceType:"integration_connection",resourceId:saved.data.id,afterState:{projectId:state.projectId,selected,email,discoveryDeferred}});
    const destination=new URL(state.returnUrl??"/portal/agency?tab=Results",`${appBaseUrl()}/`);if(destination.origin!==appBaseUrl())destination.href=`${appBaseUrl()}/portal/agency?tab=Results`;destination.searchParams.set(purpose==="google_analytics"?"ga4":"gbp","connected");if(discoveryDeferred)destination.searchParams.set("discovery","pending");return new Response(null,{status:303,headers:{location:destination.toString()}});
  }catch(error){logServerError("google_suite_callback_failed",error,{referenceId,provider:"google",operation:"oauth_callback"});return jsonError(error)}
}
