import "server-only";

import { ApiError } from "@/lib/api/errors";
import { auditEvent } from "@/lib/automation/control-plane";
import { env } from "@/lib/config/env";
import { getInstallation, listAppInstallations, listInstallationRepositories } from "@/lib/github/app-client";
import type { GitHubManagementContext } from "@/lib/github/integration-context";
import { saveRepositoryConnection } from "@/lib/github/repository-connection";

export async function findExistingInstallation(context:GitHubManagementContext){
  const stored=await context.db.from("github_installations").select("installation_id").eq("agency_id",context.agency.id).neq("status","deleted").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(stored.data?.installation_id)return Number(stored.data.installation_id);

  const installations=await listAppInstallations();
  const ids=installations.map(item=>item.id);
  if(!ids.length)return null;
  const bound=await context.db.from("github_installations").select("installation_id,agency_id").in("installation_id",ids);
  const ownership=new Map((bound.data??[]).map(item=>[Number(item.installation_id),item.agency_id]));
  const candidates=installations.filter(item=>!ownership.has(item.id)||ownership.get(item.id)===context.agency.id);
  return candidates.length===1?candidates[0].id:null;
}

export async function bindGitHubInstallation(input:{context:GitHubManagementContext;installationId:number;setupAction:string;request:Request}){
  const {context,installationId}=input;
  const [installation,repositories]=await Promise.all([getInstallation(installationId),listInstallationRepositories(installationId)]);
  if(installation.app_id!=null&&Number(installation.app_id)!==Number(env.GITHUB_APP_ID))throw new ApiError("The returned installation does not belong to the configured HD SEO GitHub App.",403,"TENANT_DENIED");

  const existing=await context.db.from("github_installations").select("agency_id").eq("installation_id",installationId).maybeSingle();
  if(existing.data&&existing.data.agency_id!==context.agency.id)throw new ApiError("This GitHub installation is already assigned to another HD SEO agency.",409,"CONFLICT");
  const now=new Date().toISOString(),saved=await context.db.from("github_installations").upsert({
    agency_id:context.agency.id,installation_id:installation.id,account_id:installation.account.id,account_login:installation.account.login,
    account_type:installation.account.type,repository_selection:installation.repository_selection,permissions:installation.permissions,events:installation.events,
    status:installation.suspended_at?"suspended":"active",installed_by:context.user.id,suspended_at:installation.suspended_at??null,last_synced_at:now,updated_at:now,
  },{onConflict:"installation_id"}).select("id").single();
  if(!saved.data)throw new ApiError("GitHub installation could not be saved.",500,"OPERATION_FAILED");

  let repositorySaved=false;
  if(context.client&&context.project){
    const current=await context.db.from("repositories").select("github_repository_id").eq("agency_id",context.agency.id).eq("project_id",context.project.id).limit(1).maybeSingle();
    const selected=repositories.find(repo=>repo.id===Number(current.data?.github_repository_id))??(repositories.length===1?repositories[0]:null);
    if(selected){await saveRepositoryConnection(context,{installationRecordId:saved.data.id,installationId:installation.id,repository:selected});repositorySaved=true;}
  }
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"github.installation.bound",resourceType:"github_installation",resourceId:String(installation.id),request:input.request,afterState:{setupAction:input.setupAction,accountLogin:installation.account.login,repositoryCount:repositories.length,repositorySaved,projectId:context.project?.id??null}});
  const result={installationId:installation.id,accountLogin:installation.account.login,repositories:repositories.map(repo=>repo.full_name),installationSaved:true,repositorySaved};
  console.info("[github.setup] binding",{jwtWorks:true,installationFound:true,installationId:result.installationId,accountLogin:result.accountLogin,repositories:result.repositories,installationSaved:result.installationSaved,repositorySaved:result.repositorySaved,agencyId:context.agency.id,clientId:context.client?.id??null,projectId:context.project?.id??null});
  return result;
}
