import { ApiError,jsonError,logServerError,type ApiErrorCode } from "@/lib/api/errors";
import { appBaseUrl,env,githubCallbackUrl } from "@/lib/config/env";
import { listUserInstallations } from "@/lib/github/app-client";
import { bindGitHubInstallation } from "@/lib/github/installation-binding";
import { resolveSignedGitHubContext } from "@/lib/github/integration-context";
import { integrationStatePurpose,verifyIntegrationState } from "@/lib/security/signed-state";
import { GET as legacyConnectCallback } from "@/app/api/github/connect/route";

function safeReturnUrl(value:string|undefined){const fallback=new URL("/admin/settings/github?connected=1",`${appBaseUrl()}/`);if(!value)return fallback;try{const url=new URL(value,fallback);return url.origin===fallback.origin&&["/admin/settings/github","/portal/agency","/portal/client"].includes(url.pathname)?url:fallback;}catch{return fallback;}}

type CallbackStage="state"|"context"|"installation"|"oauth"|"authorization"|"binding"|"response";
const stageFailure:Record<CallbackStage,{code:ApiErrorCode;message:string}>={
  state:{code:"INVALID_STATE",message:"GitHub returned an invalid or expired integration state."},
  context:{code:"INVALID_STATE",message:"The GitHub integration state could not be matched to an HD SEO project."},
  installation:{code:"MISSING_INSTALLATION_ID",message:"GitHub did not return an installation ID."},
  oauth:{code:"GITHUB_OAUTH_FAILED",message:"GitHub user verification failed."},
  authorization:{code:"INSTALLATION_LOOKUP_FAILED",message:"The GitHub installation could not be verified for this user."},
  binding:{code:"DATABASE_BINDING_FAILED",message:"The GitHub installation could not be bound to the HD SEO project."},
  response:{code:"OPERATION_FAILED",message:"The GitHub connection completed, but the final redirect failed."},
};
function callbackError(error:unknown,stage:CallbackStage){
  const fallback=stageFailure[stage],known=error instanceof ApiError&&error.code!=="OPERATION_FAILED"&&error.code!=="VALIDATION_ERROR",referenceId=error instanceof ApiError?error.referenceId:crypto.randomUUID();
  logServerError("github_callback_failed",error,{referenceId,stage,errorCode:known?(error as ApiError).code:fallback.code});
  return known?error:new ApiError(fallback.message,error instanceof ApiError?error.status:500,fallback.code,referenceId);
}

export async function GET(request:Request){
  const url=new URL(request.url),stateValue=url.searchParams.get("state");
  if(!stateValue||integrationStatePurpose(stateValue)!=="github_bind")return legacyConnectCallback(request);
  let stage:CallbackStage="state";
  try{
    const state=verifyIntegrationState(stateValue,"github_bind");
    stage="context";const context=await resolveSignedGitHubContext(state);
    stage="installation";const installationId=state.installationId;if(!installationId)throw new ApiError("GitHub did not return an installation ID.",400,"MISSING_INSTALLATION_ID");
    stage="oauth";const code=url.searchParams.get("code");if(!code)throw new ApiError("GitHub user verification did not return an authorization code.",400,"GITHUB_OAUTH_FAILED");
    if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)throw new ApiError("GitHub user verification is not configured.",503,"NOT_CONFIGURED");
    const exchange=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:githubCallbackUrl()}),cache:"no-store"}),tokenResult=await exchange.json() as {access_token?:string;error?:string};
    if(!exchange.ok||!tokenResult.access_token)throw new ApiError("GitHub user verification failed.",502,"GITHUB_OAUTH_FAILED");
    stage="authorization";
    const userInstallations=await listUserInstallations(tokenResult.access_token);
    if(!userInstallations.some(item=>item.id===installationId))throw new ApiError("The signed-in GitHub user cannot manage this installation.",403,"TENANT_DENIED");
    stage="binding";
    await bindGitHubInstallation({context,installationId,setupAction:state.setupAction??"install",request});
    stage="response";
    return new Response(null,{status:303,headers:{Location:safeReturnUrl(state.returnUrl).toString(),"Set-Cookie":`hd_github_agency=${encodeURIComponent(context.agency.id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`}});
  }catch(error){return jsonError(callbackError(error,stage));}
}
