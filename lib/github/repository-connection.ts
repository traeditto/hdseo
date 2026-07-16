import "server-only";

import { ApiError } from "@/lib/api/errors";
import { enterpriseClientId } from "@/lib/automation/control-plane";
import type { GitHubRepository } from "@/lib/github/app-client";
import type { GitHubManagementContext } from "@/lib/github/integration-context";

export async function saveRepositoryConnection(context:GitHubManagementContext,input:{installationRecordId:string;installationId:number;repository:GitHubRepository}){
  if(!context.client||!context.project)throw new ApiError("A client project is required to connect a repository.",400,"VALIDATION_ERROR");
  const repository=input.repository,clientId=await enterpriseClientId(context.client.id,context.agency.id),now=new Date().toISOString();
  const saved=await context.db.from("repositories").upsert({
    agency_id:context.agency.id,client_id:clientId,project_id:context.project.id,github_installation_id:input.installationRecordId,
    github_repository_id:repository.id,owner:repository.owner.login,name:repository.name,full_name:repository.full_name,
    default_branch:repository.default_branch,visibility:repository.visibility??(repository.private?"private":"public"),status:"active",
    repository_execution_enabled:false,last_synced_at:now,updated_at:now,
  },{onConflict:"github_installation_id,github_repository_id"}).select("id").single();
  if(!saved.data)throw new ApiError("Repository connection could not be stored.",500,"OPERATION_FAILED");
  const legacy=await context.db.from("repository_connections").upsert({
    agency_id:context.agency.id,client_organization_id:context.client.id,project_id:context.project.id,provider:"github",
    repository_owner:repository.owner.login,repository_name:repository.name,default_branch:repository.default_branch,
    installation_id:input.installationId,status:"connected",last_verified_at:now,updated_at:now,
  },{onConflict:"project_id,provider"});
  if(legacy.error)throw new ApiError("Repository execution connection could not be stored.",500,"OPERATION_FAILED");
  return{id:saved.data.id,fullName:repository.full_name,defaultBranch:repository.default_branch};
}
