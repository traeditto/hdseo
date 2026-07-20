import { z } from "zod";

import { ApiError,jsonError,logServerError } from "@/lib/api/errors";
import { env,githubCallbackUrl } from "@/lib/config/env";
import { getInstallation } from "@/lib/github/app-client";
import { findExistingInstallation } from "@/lib/github/installation-binding";
import { resolveSignedGitHubContext } from "@/lib/github/integration-context";
import {verifyIntegrationState } from "@/lib/security/signed-state";
import {consumeIntegrationState,issueIntegrationState} from "@/lib/security/integration-state-ledger";

const querySchema=z.object({installation_id:z.coerce.number().int().positive().optional(),setup_action:z.string().trim().min(1).max(32).default("install"),state:z.string().min(20)});
export async function GET(request:Request){
  let stage="request";
  try{
    const callbackUrl=new URL(request.url),raw=Object.fromEntries(callbackUrl.searchParams);
    console.info("[github.setup] callback received",{hasInstallationId:callbackUrl.searchParams.has("installation_id"),setupAction:callbackUrl.searchParams.get("setup_action")??null,hasState:callbackUrl.searchParams.has("state"),path:callbackUrl.pathname});
    const parsed=querySchema.safeParse(raw);
    if(!parsed.success)throw new ApiError(callbackUrl.searchParams.has("state")?"GitHub did not return a valid installation ID.":"GitHub did not return the signed integration state.",400,callbackUrl.searchParams.has("state")?"MISSING_INSTALLATION_ID":"INVALID_STATE");
    stage="state";const state=verifyIntegrationState(parsed.data.state,"github_install");
    stage="context";const context=await resolveSignedGitHubContext(state);await consumeIntegrationState(context.db,{rawState:parsed.data.state,state,provider:"github",callbackHost:callbackUrl.host});
    console.info("[github.setup] state verified",{agencyId:state.agencyId,clientId:state.clientId??null,projectId:state.projectId??null,hasAgencyId:Boolean(state.agencyId),hasClientId:Boolean(state.clientId),hasProjectId:Boolean(state.projectId)});
    stage="installation";
    const installationId=parsed.data.installation_id??await findExistingInstallation(context);
    if(!installationId)throw new ApiError("No GitHub installation ID was returned and no unique existing installation was found.",409,"MISSING_INSTALLATION_ID");
    const installation=await getInstallation(installationId);
    if(installation.app_id!=null&&Number(installation.app_id)!==Number(env.GITHUB_APP_ID))throw new ApiError("The returned installation does not belong to the configured HD SEO GitHub App.",403,"INSTALLATION_LOOKUP_FAILED");
    if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)throw new ApiError("GitHub user verification is not configured.",503,"NOT_CONFIGURED");
    stage="redirect";
    const bindState=await issueIntegrationState(context.db,{provider:"github",callbackHost:new URL(githubCallbackUrl()).host,state:{purpose:"github_bind",agencyId:context.agency.id,clientId:context.client?.id,projectId:context.project?.id,returnUrl:state.returnUrl,userId:context.user.id,installationId,setupAction:parsed.data.setup_action}});
    const authorizeUrl=new URL("https://github.com/login/oauth/authorize");authorizeUrl.searchParams.set("client_id",env.GITHUB_CLIENT_ID);authorizeUrl.searchParams.set("redirect_uri",githubCallbackUrl());authorizeUrl.searchParams.set("state",bindState);authorizeUrl.searchParams.set("allow_signup","false");
    console.info("[github.setup] installation verified",{jwtWorks:true,installationFound:true,installationId,accountLogin:installation.account.login,agencyId:context.agency.id,projectId:context.project?.id??null});
    return Response.redirect(authorizeUrl,303);
  }catch(error){const referenceId=error instanceof ApiError?error.referenceId:crypto.randomUUID();logServerError("github_setup_failed",error,{referenceId,stage,errorCode:error instanceof ApiError?error.code:"OPERATION_FAILED"});return jsonError(error instanceof ApiError?error:new ApiError("The GitHub setup callback failed.",500,"OPERATION_FAILED",referenceId));}
}
