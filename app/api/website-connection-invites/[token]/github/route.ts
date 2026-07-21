import { ApiError, jsonError } from "@/lib/api/errors";
import { env, githubCallbackUrl, hasGitHubInstallConfig } from "@/lib/config/env";
import { getAuthenticatedApp } from "@/lib/github/app-client";
import { findAgencyInstallationRecord } from "@/lib/github/tenant-installation";
import { createIntegrationState } from "@/lib/security/signed-state";
import { resolveWebsiteConnectionInviteForGitHub } from "@/lib/websites/connection-invites";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!hasGitHubInstallConfig) throw new ApiError("GitHub website setup is not configured.", 503, "NOT_CONFIGURED");
    const { token } = await params;
    const { invite, context } = await resolveWebsiteConnectionInviteForGitHub(token);
    const app = await getAuthenticatedApp();
    const appSlug = app.slug || env.GITHUB_APP_SLUG!;
    const returnUrl = `/connect/website/${encodeURIComponent(token)}?github=connected`;
    const existingInstallationId = (await findAgencyInstallationRecord(context.db, context.agency.id))?.installationId ?? null;
    if (existingInstallationId) {
      const state = createIntegrationState({
        purpose: "github_bind",
        agencyId: context.agency.id,
        clientId: context.client?.id,
        projectId: context.project?.id,
        returnUrl,
        userId: context.user.id,
        installationId: existingInstallationId,
        setupAction: "delegated_existing",
        handoffId: invite.id,
      });
      const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
      authorizationUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
      authorizationUrl.searchParams.set("redirect_uri", githubCallbackUrl());
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("allow_signup", "false");
      return Response.redirect(authorizationUrl, 303);
    }
    const state = createIntegrationState({
      purpose: "github_install",
      agencyId: context.agency.id,
      clientId: context.client?.id,
      projectId: context.project?.id,
      returnUrl,
      userId: context.user.id,
      setupAction: "delegated_install",
      handoffId: invite.id,
    });
    const installationUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
    installationUrl.searchParams.set("state", state);
    return Response.redirect(installationUrl, 307);
  } catch (error) {
    return jsonError(error);
  }
}
