import { z } from "zod";
import { parseJson } from "@/lib/api/request";
import { jsonError, ApiError } from "@/lib/api/errors";
import { verifyIntegrationState } from "@/lib/security/signed-state";
import { createIntegrationState } from "@/lib/security/signed-state";
import { getInstallation, githubRequest, listInstallationRepositories, type GitHubInstallation } from "@/lib/github/app-client";
import { auditEvent, requireAdminDb } from "@/lib/automation/control-plane";
import { encryptSecret,decryptSecret } from "@/lib/security/encryption";
import { env } from "@/lib/config/env";
import { resolveGitHubManagementContext, resolveSignedGitHubContext } from "@/lib/github/integration-context";
import { saveRepositoryConnection } from "@/lib/github/repository-connection";

const connectSchema = z.object({ agencyId:z.string().uuid(), clientId:z.string().uuid(), projectId:z.string().uuid(), installationId:z.coerce.number().int().positive(), repositoryId:z.coerce.number().int().positive() });

function settingsRedirect(agencyId:string,status:"connected"|"error"="connected"){
  const origin=process.env.HD_SEO_LIVE_ORIGIN||env.NEXT_PUBLIC_APP_URL||"https://hdseo.vercel.app",url=new URL("/portal/admin/settings/github",origin);
  url.searchParams.set("agencyId",agencyId);url.searchParams.set("github",status);return url;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url),code=url.searchParams.get("code"),stateValue = url.searchParams.get("state");
    if(code&&stateValue){
      const state=verifyIntegrationState(stateValue,"github_oauth"),context=await resolveSignedGitHubContext(state);
      if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.GITHUB_APP_SLUG)throw new ApiError("GitHub authorization could not be completed.",503,"NOT_CONFIGURED");
      const exchange=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:"https://hdseo.vercel.app/api/github/connect"}),cache:"no-store"}),tokenResult=await exchange.json() as {access_token?:string;error?:string};
      if(!exchange.ok||!tokenResult.access_token)throw new ApiError(`GitHub user authorization failed${tokenResult.error?` (${tokenResult.error})`:""}.`,502,"OPERATION_FAILED");
      const githubUser=await githubRequest<{id:number;login:string}>("/user",tokenResult.access_token),db=requireAdminDb(),oauth=await db.from("integration_oauth_states").insert({agency_id:context.agency.id,user_id:context.user.id,provider:"github",provider_user_id:String(githubUser.id),encrypted_access_token:encryptSecret(tokenResult.access_token),context:{clientId:state.clientId,projectId:state.projectId,githubLogin:githubUser.login},expires_at:new Date(Date.now()+10*60*1000).toISOString()}).select("id").single();
      if(!oauth.data)throw new ApiError("GitHub authorization state could not be stored.",500,"OPERATION_FAILED");
      const installState=createIntegrationState({purpose:"github_install",agencyId:context.agency.id,clientId:state.clientId,projectId:state.projectId,userId:context.user.id,oauthStateId:oauth.data.id});
      const installUrl=new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);installUrl.searchParams.set("state",installState);return Response.redirect(installUrl,303);
    }
    const installationId = Number(url.searchParams.get("installation_id"));
    if (!Number.isSafeInteger(installationId) || !stateValue) throw new ApiError("GitHub did not return a valid installation.", 400, "VALIDATION_ERROR");
    const state = verifyIntegrationState(stateValue, "github_install");
    const context = await resolveSignedGitHubContext(state);
    if(!state.oauthStateId)throw new ApiError("Verified GitHub user authorization is required.",403,"TENANT_DENIED");
    const db = requireAdminDb(),oauth=await db.from("integration_oauth_states").select("encrypted_access_token,expires_at,consumed_at").eq("id",state.oauthStateId).eq("agency_id",context.agency.id).eq("user_id",context.user.id).eq("provider","github").single();
    if(!oauth.data||oauth.data.consumed_at||new Date(oauth.data.expires_at).getTime()<Date.now())throw new ApiError("GitHub authorization has expired or was already used.",403,"TENANT_DENIED");
    const userToken=decryptSecret(oauth.data.encrypted_access_token),userInstallations=await githubRequest<{installations:GitHubInstallation[]}>("/user/installations?per_page=100",userToken);
    if(!userInstallations.installations.some(item=>item.id===installationId))throw new ApiError("The signed-in GitHub user cannot access this installation.",403,"TENANT_DENIED");
    const [installation, repositories] = await Promise.all([getInstallation(installationId), listInstallationRepositories(installationId)]);
    const existingInstallation=await db.from("github_installations").select("agency_id").eq("installation_id",installationId).maybeSingle();
    if(existingInstallation.data&&existingInstallation.data.agency_id!==context.agency.id)throw new ApiError("This GitHub installation is already assigned to another HD SEO agency.",409,"CONFLICT");
    const saved = await db.from("github_installations").upsert({
      agency_id:context.agency.id, installation_id:installation.id, account_id:installation.account.id, account_login:installation.account.login,
      account_type:installation.account.type, repository_selection:installation.repository_selection, permissions:installation.permissions,
      events:installation.events, status:installation.suspended_at?"suspended":"active", installed_by:context.user.id,
      suspended_at:installation.suspended_at??null, last_synced_at:new Date().toISOString(), updated_at:new Date().toISOString(),
    },{onConflict:"installation_id"}).select("id").single();
    if (!saved.data) throw new ApiError("GitHub installation could not be stored.", 500, "OPERATION_FAILED");
    if(context.client&&context.project&&repositories.length===1){const repository=await saveRepositoryConnection(context,{installationRecordId:saved.data.id,installationId:installation.id,repository:repositories[0]});await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"github.repository.connected",resourceType:"repository",resourceId:repository.id,request,afterState:{fullName:repository.fullName,projectId:context.project.id,automatic:true}})}
    await db.from("integration_oauth_states").delete().eq("id",state.oauthStateId);
    await auditEvent({ agencyId:context.agency.id, actorUserId:context.user.id, action:"github.installation.connected", resourceType:"github_installation", resourceId:String(installation.id), request });
    return Response.redirect(settingsRedirect(context.agency.id),303);
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, connectSchema);
    const context = await resolveGitHubManagementContext(input);
    const db = requireAdminDb();
    const installationRecord = await db.from("github_installations").select("id,installation_id,status").eq("agency_id",context.agency.id).eq("installation_id",input.installationId).single();
    if (!installationRecord.data || installationRecord.data.status!=="active") throw new ApiError("Active GitHub installation not found.", 404, "NOT_FOUND");
    const repositories = await listInstallationRepositories(input.installationId), repository = repositories.find(item=>item.id===input.repositoryId);
    if (!repository) throw new ApiError("The selected repository is not accessible to this installation.", 403, "TENANT_DENIED");
    const saved=await saveRepositoryConnection(context,{installationRecordId:installationRecord.data.id,installationId:input.installationId,repository});
    await auditEvent({ agencyId:context.agency.id, actorUserId:context.user.id, action:"github.repository.connected", resourceType:"repository", resourceId:saved.id, request, afterState:{fullName:repository.full_name,projectId:input.projectId} });
    return Response.json({ok:true,repository:saved,executionEnabled:false});
  } catch (error) { return jsonError(error); }
}
