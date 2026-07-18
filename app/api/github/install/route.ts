import { z } from "zod";
import { env, hasGitHubInstallConfig, appBaseUrl, githubCallbackUrl } from "@/lib/config/env";
import { createIntegrationState } from "@/lib/security/signed-state";
import { jsonError, ApiError } from "@/lib/api/errors";
import { getAuthenticatedApp } from "@/lib/github/app-client";
import { resolveGitHubManagementContext } from "@/lib/github/integration-context";
import { findExistingInstallation } from "@/lib/github/installation-binding";

const querySchema = z.object({ agencyId:z.string().uuid(), clientId:z.string().uuid().optional(), projectId:z.string().uuid().optional(), returnUrl:z.string().max(500).optional() });

function safeReturnUrl(value:string|undefined){
  const base=new URL(appBaseUrl()),fallback=new URL("/admin/settings/github?connected=1",base);
  if(!value)return fallback.toString();
  try{const url=new URL(value,base);return url.origin===base.origin&&["/admin/settings/github","/portal/agency"].includes(url.pathname)?url.toString():fallback.toString();}
  catch{return fallback.toString();}
}

export async function GET(request: Request) {
  try {
    if (!hasGitHubInstallConfig) throw new ApiError("GitHub App installation is not configured.", 503, "NOT_CONFIGURED");
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ApiError("A valid agency is required.", 400, "VALIDATION_ERROR");
    const context = await resolveGitHubManagementContext(parsed.data);
    const app=await getAuthenticatedApp(),appSlug=app.slug||env.GITHUB_APP_SLUG!;
    const returnUrl=safeReturnUrl(parsed.data.returnUrl);
    const existingInstallationId=await findExistingInstallation(context);
    if(existingInstallationId){
      const bindState=createIntegrationState({purpose:"github_bind",agencyId:context.agency.id,clientId:context.client?.id,projectId:context.project?.id,returnUrl,userId:context.user.id,installationId:existingInstallationId,setupAction:"existing"});
      const authorizeUrl=new URL("https://github.com/login/oauth/authorize");
      authorizeUrl.searchParams.set("client_id",env.GITHUB_CLIENT_ID!);
      authorizeUrl.searchParams.set("redirect_uri",githubCallbackUrl());
      authorizeUrl.searchParams.set("state",bindState);
      authorizeUrl.searchParams.set("allow_signup","false");
      console.info("[github.install] existing installation detected",{appSlug,installationId:existingInstallationId,agencyId:context.agency.id,clientId:context.client?.id??null,projectId:context.project?.id??null,flow:"verify_and_bind"});
      return Response.redirect(authorizeUrl,303);
    }
    const state = createIntegrationState({ purpose:"github_install", agencyId:context.agency.id, clientId:context.client?.id, projectId:context.project?.id, returnUrl, userId:context.user.id });
    const installationUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
    installationUrl.searchParams.set("state", state);
    console.info("[github.install] redirect",{appSlug,configuredSlug:env.GITHUB_APP_SLUG,installationUrlBase:installationUrl.origin+installationUrl.pathname,agencyId:context.agency.id,clientId:context.client?.id??null,projectId:context.project?.id??null});
    return Response.redirect(installationUrl, 307);
  } catch (error) { return jsonError(error); }
}
