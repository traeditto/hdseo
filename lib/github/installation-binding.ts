import "server-only";

import { ApiError,logServerError } from "@/lib/api/errors";
import { auditEvent } from "@/lib/automation/control-plane";
import { env } from "@/lib/config/env";
import { getInstallation, listAppInstallations, listInstallationRepositories } from "@/lib/github/app-client";
import type { GitHubManagementContext } from "@/lib/github/integration-context";
import { saveRepositoryConnection } from "@/lib/github/repository-connection";
import { selectRepositoryForProject } from "@/lib/github/repository-selection";
import { upsertGitHubWebsite } from "@/lib/websites/connections";
import { findAgencyInstallationRecord } from "@/lib/github/tenant-installation";

function databaseBindingError(message:string,error:unknown,context:GitHubManagementContext,stage:string):never{
  const apiError=new ApiError(message,500,"DATABASE_BINDING_FAILED");
  const detail=error instanceof Error?error:new Error(typeof error==="object"&&error?JSON.stringify(error):String(error));
  logServerError("github_database_binding_failed",detail,{referenceId:apiError.referenceId,agencyId:context.agency.id,clientId:context.client?.id,projectId:context.project?.id,stage});
  throw apiError;
}

export async function findExistingInstallation(context:GitHubManagementContext){
  const stored=await findAgencyInstallationRecord(context.db,context.agency.id);
  if(stored?.installationId)return stored.installationId;

  const installations=await listAppInstallations();
  return installations.length===1?installations[0].id:null;
}

export async function bindGitHubInstallation(input:{context:GitHubManagementContext;installationId:number;setupAction:string;request:Request}){
  const {context,installationId}=input;
  const [installation,repositories]=await Promise.all([getInstallation(installationId),listInstallationRepositories(installationId)]);
  if(installation.app_id!=null&&Number(installation.app_id)!==Number(env.GITHUB_APP_ID))throw new ApiError("The returned installation does not belong to the configured HD SEO GitHub App.",403,"INSTALLATION_LOOKUP_FAILED");

  const existing=await context.db.from("github_installations").select("id,agency_id").eq("installation_id",installationId).maybeSingle();
  if(existing.error)databaseBindingError("GitHub installation ownership could not be verified.",existing.error,context,"installation.ownership");
  const now=new Date().toISOString();
  const installationValues={
    agency_id:context.agency.id,installation_id:installation.id,account_id:installation.account.id,account_login:installation.account.login,
    account_type:installation.account.type,repository_selection:installation.repository_selection,permissions:installation.permissions,events:installation.events,
    status:installation.suspended_at?"suspended":"active",installed_by:context.user.id,suspended_at:installation.suspended_at??null,last_synced_at:now,updated_at:now,
  };
  const saved=existing.data
    ? await context.db.from("github_installations").update({...installationValues,agency_id:existing.data.agency_id}).eq("id",existing.data.id).select("id").single()
    : await context.db.from("github_installations").insert(installationValues).select("id").single();
  if(saved.error||!saved.data)databaseBindingError("GitHub installation could not be saved.",saved.error,context,"installation.upsert");

  let repositorySaved=false;
  if(context.client&&context.project){
    const current=await context.db.from("repositories").select("github_repository_id").eq("agency_id",context.agency.id).eq("project_id",context.project.id).limit(1).maybeSingle();
    if(current.error)databaseBindingError("Existing repository binding could not be loaded.",current.error,context,"repository.lookup");
    const currentRepositoryId=current.data?.github_repository_id?Number(current.data.github_repository_id):null;
    const selected=currentRepositoryId
      ? repositories.find(repo=>repo.id===currentRepositoryId)
      : selectRepositoryForProject(repositories,{clientName:context.client.name,projectName:context.project.name,domain:context.project.domain});
    if(currentRepositoryId&&!selected)throw new ApiError("The repository previously assigned to this project is not authorized for this GitHub installation.",409,"REPOSITORY_NOT_AUTHORIZED");
    if(!repositories.length)throw new ApiError("The GitHub installation does not grant access to a repository for this project.",409,"REPOSITORY_NOT_AUTHORIZED");
    if(selected){
      await saveRepositoryConnection(context,{installationRecordId:saved.data.id,installationId:installation.id,repository:selected});
      await upsertGitHubWebsite({db:context.db,agencyId:context.agency.id,clientId:context.client.id,projectId:context.project.id,projectName:context.client.name,domain:context.project.domain});
      repositorySaved=true;
    }
  }
  try{await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"github.installation.bound",resourceType:"github_installation",resourceId:String(installation.id),request:input.request,afterState:{setupAction:input.setupAction,accountLogin:installation.account.login,repositoryCount:repositories.length,repositorySaved,projectId:context.project?.id??null,sharedInstallationRecord:existing.data?.agency_id!==undefined&&existing.data.agency_id!==context.agency.id}});}catch(error){databaseBindingError("GitHub installation audit record could not be saved.",error,context,"audit.insert");}
  const result={installationId:installation.id,accountLogin:installation.account.login,repositories:repositories.map(repo=>repo.full_name),installationSaved:true,repositorySaved};
  console.info("[github.setup] binding",{jwtWorks:true,installationFound:true,installationId:result.installationId,accountLogin:result.accountLogin,repositories:result.repositories,installationSaved:result.installationSaved,repositorySaved:result.repositorySaved,agencyId:context.agency.id,clientId:context.client?.id??null,projectId:context.project?.id??null});
  return result;
}
