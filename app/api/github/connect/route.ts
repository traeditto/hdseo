import { z } from "zod";
import { resolveTenantContext, requirePermission } from "@/lib/auth/context";
import { parseJson } from "@/lib/api/request";
import { jsonError, ApiError } from "@/lib/api/errors";
import { verifyIntegrationState } from "@/lib/security/signed-state";
import { createIntegrationState } from "@/lib/security/signed-state";
import { getInstallation, githubRequest, listInstallationRepositories, type GitHubInstallation } from "@/lib/github/app-client";
import { auditEvent, enterpriseClientId, requireAdminDb } from "@/lib/automation/control-plane";
import { encryptSecret,decryptSecret } from "@/lib/security/encryption";
import { env } from "@/lib/config/env";

const connectSchema = z.object({ agencyId:z.string().uuid(), clientId:z.string().uuid(), projectId:z.string().uuid(), installationId:z.coerce.number().int().positive(), repositoryId:z.coerce.number().int().positive() });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url),code=url.searchParams.get("code"),stateValue = url.searchParams.get("state");
    if(code&&stateValue){
      const state=verifyIntegrationState(stateValue,"github_oauth"),context=await resolveTenantContext({agencyId:state.agencyId,clientId:state.clientId,projectId:state.projectId,requireProject:Boolean(state.projectId)});requirePermission(context,"integrations.manage");
      if(context.user.id!==state.userId||!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.GITHUB_APP_SLUG)throw new ApiError("GitHub authorization could not be completed.",403,"TENANT_DENIED");
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
    const context = await resolveTenantContext({ agencyId:state.agencyId, clientId:state.clientId, projectId:state.projectId, requireProject:Boolean(state.projectId) });
    requirePermission(context, "integrations.manage");
    if (context.user.id !== state.userId) throw new ApiError("The GitHub connection belongs to a different session.", 403, "TENANT_DENIED");
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
    await db.from("integration_oauth_states").delete().eq("id",state.oauthStateId);
    await auditEvent({ agencyId:context.agency.id, actorUserId:context.user.id, action:"github.installation.connected", resourceType:"github_installation", resourceId:String(installation.id), request });
    return Response.json({ ok:true, installation:{ id:installation.id, account:installation.account.login, repositorySelection:installation.repository_selection }, repositories:repositories.map(repo=>({id:repo.id,fullName:repo.full_name,defaultBranch:repo.default_branch,visibility:repo.visibility??(repo.private?"private":"public")})) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, connectSchema);
    const context = await resolveTenantContext({ agencyId:input.agencyId, clientId:input.clientId, projectId:input.projectId, requireProject:true });
    requirePermission(context, "integrations.manage");
    const db = requireAdminDb();
    const installationRecord = await db.from("github_installations").select("id,installation_id,status").eq("agency_id",context.agency.id).eq("installation_id",input.installationId).single();
    if (!installationRecord.data || installationRecord.data.status!=="active") throw new ApiError("Active GitHub installation not found.", 404, "NOT_FOUND");
    const repositories = await listInstallationRepositories(input.installationId), repository = repositories.find(item=>item.id===input.repositoryId);
    if (!repository) throw new ApiError("The selected repository is not accessible to this installation.", 403, "TENANT_DENIED");
    const clientId = await enterpriseClientId(input.clientId, context.agency.id);
    const saved = await db.from("repositories").upsert({
      agency_id:context.agency.id, client_id:clientId, project_id:input.projectId, github_installation_id:installationRecord.data.id,
      github_repository_id:repository.id, owner:repository.owner.login, name:repository.name, full_name:repository.full_name,
      default_branch:repository.default_branch, visibility:repository.visibility??(repository.private?"private":"public"), status:"active",
      repository_execution_enabled:false, last_synced_at:new Date().toISOString(), updated_at:new Date().toISOString(),
    },{onConflict:"github_installation_id,github_repository_id"}).select("id").single();
    if (!saved.data) throw new ApiError("Repository connection could not be stored.", 500, "OPERATION_FAILED");
    await db.from("repository_connections").upsert({
      agency_id:context.agency.id,client_organization_id:input.clientId,project_id:input.projectId,provider:"github",
      repository_owner:repository.owner.login,repository_name:repository.name,default_branch:repository.default_branch,
      installation_id:input.installationId,status:"connected",last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    },{onConflict:"project_id,provider"});
    await auditEvent({ agencyId:context.agency.id, actorUserId:context.user.id, action:"github.repository.connected", resourceType:"repository", resourceId:saved.data.id, request, afterState:{fullName:repository.full_name,projectId:input.projectId} });
    return Response.json({ok:true,repository:{id:saved.data.id,fullName:repository.full_name,defaultBranch:repository.default_branch},executionEnabled:false});
  } catch (error) { return jsonError(error); }
}
