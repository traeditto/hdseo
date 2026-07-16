import { z } from "zod";
import { resolveTenantContext, requirePermission } from "@/lib/auth/context";
import { env, hasGitHubInstallConfig } from "@/lib/config/env";
import { createIntegrationState } from "@/lib/security/signed-state";
import { jsonError, ApiError } from "@/lib/api/errors";

const querySchema = z.object({ agencyId:z.string().uuid(), clientId:z.string().uuid().optional(), projectId:z.string().uuid().optional() });

export async function GET(request: Request) {
  try {
    if (!hasGitHubInstallConfig) throw new ApiError("GitHub App installation is not configured.", 503, "NOT_CONFIGURED");
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ApiError("A valid agency is required.", 400, "VALIDATION_ERROR");
    const context = await resolveTenantContext({ ...parsed.data, requireProject: Boolean(parsed.data.projectId) });
    requirePermission(context, "integrations.manage");
    const state = createIntegrationState({ purpose:"github_oauth", agencyId:context.agency.id, clientId:context.client?.id, projectId:context.project?.id, userId:context.user.id });
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
    authorizeUrl.searchParams.set("redirect_uri", "https://hdseo.vercel.app/api/github/connect");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("allow_signup", "false");
    return Response.redirect(authorizeUrl, 307);
  } catch (error) { return jsonError(error); }
}
