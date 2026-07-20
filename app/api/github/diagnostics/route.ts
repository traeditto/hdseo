import { z } from "zod";

import { ApiError,jsonError } from "@/lib/api/errors";
import { appBaseUrl,env,githubSetupUrl } from "@/lib/config/env";
import { getAuthenticatedApp,getInstallation,listInstallationRepositories } from "@/lib/github/app-client";
import { findExistingInstallation } from "@/lib/github/installation-binding";
import { resolveGitHubManagementContext } from "@/lib/github/integration-context";
import {issueIntegrationState} from "@/lib/security/integration-state-ledger";

const querySchema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid().optional(),projectId:z.string().uuid().optional()});

export async function GET(request:Request){
  try{
    const parsed=querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if(!parsed.success)throw new ApiError("A valid agency is required.",400,"VALIDATION_ERROR");
    const context=await resolveGitHubManagementContext(parsed.data),app=await getAuthenticatedApp(),installationId=await findExistingInstallation(context);
    const installation=installationId?await getInstallation(installationId):null,repositories=installationId?await listInstallationRepositories(installationId):[];
    const stored=installationId?await context.db.from("github_installations").select("id").eq("agency_id",context.agency.id).eq("installation_id",installationId).neq("status","deleted").maybeSingle():{data:null};
    const returnUrl=new URL("/admin/settings/github?connected=1",`${appBaseUrl()}/`).toString(),state=await issueIntegrationState(context.db,{provider:"github",callbackHost:new URL("/api/github/setup",appBaseUrl()).host,state:{purpose:"github_install",agencyId:context.agency.id,clientId:context.client?.id,projectId:context.project?.id,returnUrl,userId:context.user.id}}),installationUrl=new URL(`https://github.com/apps/${app.slug||env.GITHUB_APP_SLUG}/installations/new`);installationUrl.searchParams.set("state",state);
    const result={jwtWorks:true,app:{id:app.id,name:app.name,slug:app.slug,owner:app.owner.login},setupUrl:githubSetupUrl(),installationUrl:installationUrl.toString(),installationFound:Boolean(installation),installation:installation?{id:installation.id,accountLogin:installation.account.login,repositorySelection:installation.repository_selection}:null,accessibleRepositories:repositories.map(repo=>repo.full_name),installationSaved:Boolean(stored.data)};
    console.info("[github.diagnostics]",{jwtWorks:result.jwtWorks,appSlug:result.app.slug,installationFound:result.installationFound,accountLogin:result.installation?.accountLogin??null,accessibleRepositories:result.accessibleRepositories,installationSaved:result.installationSaved,agencyId:context.agency.id});
    return Response.json({ok:true,diagnostics:result});
  }catch(error){return jsonError(error);}
}
