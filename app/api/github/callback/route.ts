import { ApiError,jsonError } from "@/lib/api/errors";
import { appBaseUrl,env,githubCallbackUrl } from "@/lib/config/env";
import { listUserInstallations } from "@/lib/github/app-client";
import { bindGitHubInstallation } from "@/lib/github/installation-binding";
import { resolveSignedGitHubContext } from "@/lib/github/integration-context";
import { integrationStatePurpose,verifyIntegrationState } from "@/lib/security/signed-state";
import { GET as legacyConnectCallback } from "@/app/api/github/connect/route";

function safeReturnUrl(value:string|undefined){const fallback=new URL("/admin/settings/github?connected=1",`${appBaseUrl()}/`);if(!value)return fallback;try{const url=new URL(value);return url.origin===fallback.origin&&url.pathname==="/admin/settings/github"?url:fallback;}catch{return fallback;}}

export async function GET(request:Request){
  const url=new URL(request.url),stateValue=url.searchParams.get("state");
  if(!stateValue||integrationStatePurpose(stateValue)!=="github_bind")return legacyConnectCallback(request);
  try{
    const code=url.searchParams.get("code");if(!code)throw new ApiError("GitHub user verification did not return an authorization code.",400,"VALIDATION_ERROR");
    const state=verifyIntegrationState(stateValue,"github_bind"),context=await resolveSignedGitHubContext(state),installationId=state.installationId;
    if(!installationId||!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)throw new ApiError("GitHub installation verification is not configured.",503,"NOT_CONFIGURED");
    const exchange=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:githubCallbackUrl()}),cache:"no-store"}),tokenResult=await exchange.json() as {access_token?:string;error?:string};
    if(!exchange.ok||!tokenResult.access_token)throw new ApiError(`GitHub user verification failed${tokenResult.error?` (${tokenResult.error})`:""}.`,502,"OPERATION_FAILED");
    const userInstallations=await listUserInstallations(tokenResult.access_token);
    if(!userInstallations.some(item=>item.id===installationId))throw new ApiError("The signed-in GitHub user cannot manage this installation.",403,"TENANT_DENIED");
    await bindGitHubInstallation({context,installationId,setupAction:state.setupAction??"install",request});
    const response=Response.redirect(safeReturnUrl(state.returnUrl),303);response.headers.append("Set-Cookie",`hd_github_agency=${encodeURIComponent(context.agency.id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);return response;
  }catch(error){return jsonError(error);}
}
