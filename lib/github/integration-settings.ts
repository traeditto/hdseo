import "server-only";

import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError } from "@/lib/api/errors";
import { getLiveAdminClient, resolveLiveIdentity } from "@/lib/live/identity";
import { listInstallationRepositories } from "@/lib/github/app-client";

export type GitHubSettingsSnapshot = {
  agencies: Array<{id:string;name:string;slug:string}>;
  selectedAgencyId: string | null;
  installation: null | {id:string;installationId:number;accountLogin:string;accountType:string;repositorySelection:string;status:string;lastSyncedAt:string|null};
  connectedRepositories: Array<{id:string;owner:string;name:string;fullName:string;defaultBranch:string;status:string;projectId:string;projectName:string}>;
  availableRepositories: Array<{id:number;fullName:string;defaultBranch:string;visibility:string}>;
  projects: Array<{id:string;name:string;domain:string;clientId:string;clientName:string}>;
  lastWebhook: null | {eventType:string;receivedAt:string;status:string};
  connectionError: string | null;
};

export async function githubAdminSettingsSnapshot(user: ChatGPTUser, requestedAgencyId?: string): Promise<GitHubSettingsSnapshot> {
  const db=getLiveAdminClient(),identity=await resolveLiveIdentity(db,user);
  if(!identity.isPlatformAdmin)throw new ApiError("Platform administration access denied.",403,"ROLE_FORBIDDEN");
  const agenciesResult=await db.from("agencies").select("id,name,slug").eq("status","active").order("name");
  const agencies=agenciesResult.data??[],selectedAgencyId=agencies.some(item=>item.id===requestedAgencyId)?requestedAgencyId??null:agencies[0]?.id??null;
  if(!selectedAgencyId)return{agencies,selectedAgencyId:null,installation:null,connectedRepositories:[],availableRepositories:[],projects:[],lastWebhook:null,connectionError:null};

  const[installationResult,repositoriesResult,projectsResult,webhookResult]=await Promise.all([
    db.from("github_installations").select("id,installation_id,account_login,account_type,repository_selection,status,last_synced_at").eq("agency_id",selectedAgencyId).neq("status","deleted").order("updated_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("repositories").select("id,owner,name,full_name,default_branch,status,project_id").eq("agency_id",selectedAgencyId).order("full_name"),
    db.from("seo_projects").select("id,name,domain,client_organization_id,client_organizations(name)").eq("agency_id",selectedAgencyId).eq("status","active").order("name"),
    db.from("webhook_events").select("event_type,received_at,status").eq("provider","github").eq("agency_id",selectedAgencyId).order("received_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(installationResult.error)throw new ApiError("GitHub installation status could not be loaded.",500,"OPERATION_FAILED");
  if(repositoriesResult.error||projectsResult.error)throw new ApiError("GitHub repository status could not be loaded.",500,"OPERATION_FAILED");

  const projectName=new Map((projectsResult.data??[]).map(item=>[item.id,item.name]));
  const installation=installationResult.data?{id:installationResult.data.id,installationId:Number(installationResult.data.installation_id),accountLogin:installationResult.data.account_login,accountType:installationResult.data.account_type,repositorySelection:installationResult.data.repository_selection,status:installationResult.data.status,lastSyncedAt:installationResult.data.last_synced_at}:null;
  let availableRepositories:GitHubSettingsSnapshot["availableRepositories"]=[],connectionError:string|null=null;
  if(installation?.status==="active")try{availableRepositories=(await listInstallationRepositories(installation.installationId)).map(repo=>({id:repo.id,fullName:repo.full_name,defaultBranch:repo.default_branch,visibility:repo.visibility??(repo.private?"private":"public")}));}catch{connectionError="GitHub could not be reached. Use Test Connection to retry."}

  return{
    agencies,selectedAgencyId,installation,
    connectedRepositories:(repositoriesResult.data??[]).map(repo=>({id:repo.id,owner:repo.owner,name:repo.name,fullName:repo.full_name,defaultBranch:repo.default_branch,status:repo.status,projectId:repo.project_id,projectName:projectName.get(repo.project_id)??"Unknown project"})),
    availableRepositories,
    projects:(projectsResult.data??[]).map(project=>{const client=Array.isArray(project.client_organizations)?project.client_organizations[0]:project.client_organizations;return{id:project.id,name:project.name,domain:project.domain,clientId:project.client_organization_id,clientName:client?.name??"Client"}}),
    lastWebhook:webhookResult.data?{eventType:webhookResult.data.event_type,receivedAt:webhookResult.data.received_at,status:webhookResult.data.status}:null,
    connectionError,
  };
}
