import { z } from "zod";

import { ApiError,jsonError } from "@/lib/api/errors";
import { env,githubCallbackUrl } from "@/lib/config/env";
import { getInstallation } from "@/lib/github/app-client";
import { findExistingInstallation } from "@/lib/github/installation-binding";
import { resolveSignedGitHubContext } from "@/lib/github/integration-context";
import { createIntegrationState,verifyIntegrationState } from "@/lib/security/signed-state";

const querySchema=z.object({installation_id:z.coerce.number().int().positive().optional(),setup_action:z.string().trim().min(1).max(32).default("install"),state:z.string().min(20)});
export async function GET(request:Request){
  try{
    const parsed=querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if(!parsed.success)throw new ApiError("GitHub did not return a valid setup response.",400,"VALIDATION_ERROR");
    const state=verifyIntegrationState(parsed.data.state,"github_install"),context=await resolveSignedGitHubContext(state);
    const installationId=parsed.data.installation_id??await findExistingInstallation(context);
    if(!installationId)throw new ApiError("No unique existing installation was found. Open Connect GitHub and choose the account that owns the installation.",409,"CONFLICT");
    const installation=await getInstallation(installationId);
    if(installation.app_id!=null&&Number(installation.app_id)!==Number(env.GITHUB_APP_ID))throw new ApiError("The returned installation does not belong to the configured HD SEO GitHub App.",403,"TENANT_DENIED");
    if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)throw new ApiError("GitHub user verification is not configured.",503,"NOT_CONFIGURED");
    const bindState=createIntegrationState({purpose:"github_bind",agencyId:context.agency.id,clientId:context.client?.id,projectId:context.project?.id,returnUrl:state.returnUrl,userId:context.user.id,installationId,setupAction:parsed.data.setup_action});
    const authorizeUrl=new URL("https://github.com/login/oauth/authorize");authorizeUrl.searchParams.set("client_id",env.GITHUB_CLIENT_ID);authorizeUrl.searchParams.set("redirect_uri",githubCallbackUrl());authorizeUrl.searchParams.set("state",bindState);authorizeUrl.searchParams.set("allow_signup","false");
    console.info("[github.setup] installation verified",{jwtWorks:true,installationFound:true,installationId,accountLogin:installation.account.login,agencyId:context.agency.id,projectId:context.project?.id??null});
    return Response.redirect(authorizeUrl,303);
  }catch(error){return jsonError(error);}
}
