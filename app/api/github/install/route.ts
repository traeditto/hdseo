import { z } from "zod";
import { env, hasGitHubInstallConfig, appBaseUrl } from "@/lib/config/env";
import { createIntegrationState } from "@/lib/security/signed-state";
import { jsonError, ApiError } from "@/lib/api/errors";
import { getAuthenticatedApp } from "@/lib/github/app-client";
import { resolveGitHubManagementContext } from "@/lib/github/integration-context";

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
    const state = createIntegrationState({ purpose:"github_install", agencyId:context.agency.id, clientId:context.client?.id, projectId:context.project?.id, returnUrl, userId:context.user.id });
    const installationUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
    installationUrl.searchParams.set("state", state);
    console.info("[github.install] redirect",{appSlug,configuredSlug:env.GITHUB_APP_SLUG,installationUrlBase:installationUrl.origin+installationUrl.pathname,agencyId:context.agency.id,clientId:context.client?.id??null,projectId:context.project?.id??null});
    return Response.redirect(installationUrl, 307);
  } catch (error) { return jsonError(error); }
}
