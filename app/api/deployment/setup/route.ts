import { z } from "zod";

import { ApiError, jsonError } from "@/lib/api/errors";
import { auditEvent, requireAdminDb } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { getInstallation, listInstallationRepositories } from "@/lib/github/app-client";
import { parseJson } from "@/lib/api/request";
import { getVercelProject, vercelRequest } from "@/lib/vercel/client";
import { loadVercelCredentials } from "@/lib/vercel/credentials";
import { ensureVercelAutomationBypass } from "@/lib/vercel/protection-bypass";

const scopeSchema = z.object({
  agencyId: z.string().uuid(),
  clientId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const testSchema = scopeSchema.extend({
  action: z.enum(["test_connections", "verify_safety_baseline"]),
});

type Readiness = {
  ready?: boolean;
  blockers?: string[];
  completedRequirements?: string[];
  recommendedNextStep?: string;
};

async function loadSetupState(scope: z.infer<typeof scopeSchema>) {
  const context = await requireLiveAgencyProject({
    projectId: scope.projectId,
    permission: "integrations.manage",
  });
  if (context.agencyId !== scope.agencyId || context.clientId !== scope.clientId) {
    throw new ApiError("Deployment setup does not belong to this business.", 403, "TENANT_DENIED");
  }
  const db = requireAdminDb();

  const [agency, project, repositories, connections, vercelProjects, readiness] =
    await Promise.all([
      db
        .from("agencies")
        .select("repository_execution_enabled")
        .eq("id", context.agencyId)
        .single(),
      db
        .from("seo_projects")
        .select("repository_execution_enabled,manual_workflow_verified_at")
        .eq("id", context.project.id)
        .eq("agency_id", context.agencyId)
        .single(),
      db
        .from("repositories")
        .select(
          "id,full_name,default_branch,github_repository_id,github_installation_id,status,repository_execution_enabled,last_synced_at",
        )
        .eq("agency_id", context.agencyId)
        .eq("project_id", context.project.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1),
      db
        .from("vercel_connections")
        .select(
          "id,team_id,team_slug,account_type,status,last_verified_at,updated_at",
        )
        .eq("agency_id", context.agencyId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1),
      db
        .from("vercel_projects")
        .select(
          "id,connection_id,repository_id,vercel_project_id,name,production_branch,production_domains,environment_config,status,last_synced_at",
        )
        .eq("agency_id", context.agencyId)
        .eq("project_id", context.project.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1),
      db.rpc("github_execution_readiness", {
        target_agency: context.agencyId,
        target_project: context.project.id,
      }),
    ]);

  if (
    agency.error ||
    project.error ||
    repositories.error ||
    connections.error ||
    vercelProjects.error ||
    readiness.error
  ) {
    throw new ApiError(
      "Deployment setup status could not be evaluated.",
      500,
      "OPERATION_FAILED",
    );
  }

  const repository = repositories.data?.[0] ?? null;
  const connection = connections.data?.[0] ?? null;
  const vercelProject = vercelProjects.data?.[0] ?? null;
  let installation: {
    id: string;
    installationId: number;
    accountLogin: string;
    status: string;
  } | null = null;

  if (repository?.github_installation_id) {
    const result = await db
      .from("github_installations")
      .select("id,installation_id,account_login,status")
      .eq("id", repository.github_installation_id)
      .maybeSingle();
    if (result.data) {
      installation = {
        id: result.data.id,
        installationId: Number(result.data.installation_id),
        accountLogin: result.data.account_login,
        status: result.data.status,
      };
    }
  }

  const githubReadiness = (readiness.data ?? {
    ready: false,
    blockers: ["PROJECT_NOT_FOUND"],
    completedRequirements: [],
  }) as Readiness;
  const manualWorkflowVerified = Boolean(project.data?.manual_workflow_verified_at);
  const repositoryConnected = Boolean(repository && installation?.status === "active");
  const vercelConnectionActive = Boolean(connection);
  const vercelProjectConnected = Boolean(
    vercelProject && vercelProject.repository_id === repository?.id,
  );
  const automationEnabled = Boolean(
    githubReadiness.ready && repository?.repository_execution_enabled,
  );

  return {
    context,
    db,
    state: {
      project: {
        id: context.project.id,
        clientId: context.clientId,
        name: context.project.name,
        domain: context.project.domain,
      },
      installation,
      repository: repository
        ? {
            id: repository.id,
            fullName: repository.full_name,
            defaultBranch: repository.default_branch,
            providerId: Number(repository.github_repository_id),
            lastSyncedAt: repository.last_synced_at,
          }
        : null,
      vercelConnection: connection
        ? {
            id: connection.id,
            accountType: connection.account_type,
            teamId: connection.team_id,
            teamSlug: connection.team_slug,
            lastVerifiedAt: connection.last_verified_at,
          }
        : null,
      vercelProject: vercelProject
        ? {
            id: vercelProject.id,
            providerId: vercelProject.vercel_project_id,
            name: vercelProject.name,
            productionBranch: vercelProject.production_branch,
            productionDomains: vercelProject.production_domains ?? [],
            environmentConfig: vercelProject.environment_config ?? {},
            lastSyncedAt: vercelProject.last_synced_at,
          }
        : null,
      readiness: {
        ready: automationEnabled,
        blockers: githubReadiness.blockers ?? [],
        completedRequirements: githubReadiness.completedRequirements ?? [],
        recommendedNextStep: githubReadiness.recommendedNextStep ?? null,
      },
      checks: {
        repositoryConnected,
        vercelConnectionActive,
        vercelProjectConnected,
        manualWorkflowVerified,
        automationEnabled,
        complete:
          repositoryConnected &&
          vercelConnectionActive &&
          vercelProjectConnected &&
          manualWorkflowVerified &&
          automationEnabled,
      },
    },
  };
}

export async function GET(request: Request) {
  try {
    const parsed = scopeSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      throw new ApiError(
        "A valid agency, client, and project are required.",
        400,
        "VALIDATION_ERROR",
      );
    }
    const { state } = await loadSetupState(parsed.data);
    return Response.json({ ok: true, setup: state });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, testSchema);
    const { context, db, state } = await loadSetupState(input);
    if (!state.installation || !state.repository) {
      throw new ApiError(
        "Connect a GitHub repository before testing deployment access.",
        409,
        "CONFLICT",
      );
    }
    if (!state.vercelConnection || !state.vercelProject) {
      throw new ApiError(
        "Connect the agency Vercel account and project before testing deployment access.",
        409,
        "CONFLICT",
      );
    }

    const [installation, accessibleRepositories] = await Promise.all([
      getInstallation(state.installation.installationId),
      listInstallationRepositories(state.installation.installationId),
    ]);
    const repositoryAvailable = accessibleRepositories.some(
      (item) => item.id === state.repository!.providerId,
    );
    if (!repositoryAvailable) {
      throw new ApiError(
        "The selected GitHub repository is no longer authorized for this installation.",
        409,
        "REPOSITORY_NOT_AUTHORIZED",
      );
    }

    const credentials = await loadVercelCredentials(
      state.vercelConnection.id,
      context.agencyId,
    );
    const [vercelAccount, providerProject] = await Promise.all([
      vercelRequest<{ user: { id: string; username?: string } }>(
        "/v2/user",
        credentials,
      ),
      getVercelProject(credentials, state.vercelProject.providerId),
    ]);

    const verifiedAt = new Date().toISOString();
    if (input.action === "verify_safety_baseline") {
      const bypass = await ensureVercelAutomationBypass({
        credentials,
        projectId: state.vercelProject.providerId,
        environmentConfig: state.vercelProject.environmentConfig,
      });
      if (bypass.created) {
        const savedBypass = await db
          .from("vercel_projects")
          .update({ environment_config: bypass.environmentConfig, updated_at: verifiedAt })
          .eq("id", state.vercelProject.id)
          .eq("agency_id", context.agencyId);
        if (savedBypass.error) {
          throw new ApiError("The protected preview credential could not be stored safely.", 500, "DATABASE_BINDING_FAILED");
        }
      }
      const saved = await db
        .from("seo_projects")
        .update({ manual_workflow_verified_at: verifiedAt, updated_at: verifiedAt })
        .eq("id", context.project.id)
        .eq("agency_id", context.agencyId);
      if (saved.error) {
        throw new ApiError("The verified safety baseline could not be saved.", 500, "DATABASE_BINDING_FAILED");
      }
    }

    await auditEvent({
      agencyId: context.agencyId,
      actorUserId: context.userId,
      action: input.action === "verify_safety_baseline"
        ? "deployment.setup.safety_baseline_verified"
        : "deployment.setup.tested",
      resourceType: "seo_project",
      resourceId: context.project.id,
      request,
      afterState: {
        githubInstallationId: installation.id,
        repository: state.repository.fullName,
        vercelProjectId: providerProject.id,
        ready: input.action === "verify_safety_baseline" ? true : state.checks.complete,
      },
    });

    return Response.json({
      ok: true,
      message: input.action === "verify_safety_baseline"
        ? "GitHub, Vercel, and the safe deployment baseline are verified."
        : "GitHub and Vercel access verified.",
      test: {
        github: {
          account: installation.account.login,
          repository: state.repository.fullName,
          accessible: true,
        },
        vercel: {
          account: vercelAccount.user.username ?? vercelAccount.user.id,
          project: providerProject.name,
          accessible: true,
          protectedPreviewValidation: input.action === "verify_safety_baseline",
        },
        automationReady: input.action === "verify_safety_baseline" ? false : state.checks.complete,
        testedAt: verifiedAt,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
