import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { ApiError, logServerError } from "@/lib/api/errors";
import { hasPermission, type AgencyRole } from "@/lib/auth/permissions";
import { appBaseUrl, env } from "@/lib/config/env";
import { listInstallationRepositories } from "@/lib/github/app-client";
import { resolveDelegatedGitHubContext } from "@/lib/github/integration-context";
import { saveRepositoryConnection } from "@/lib/github/repository-connection";
import { getLiveAdminClient } from "@/lib/live/identity";
import { connectWebsite, upsertGitHubWebsite, type ConnectWebsiteInput } from "@/lib/websites/connections";

const ACTIVE_STATUSES = ["pending", "opened", "processing"];
const DEFAULT_METHODS = ["wordpress", "shopify", "webflow", "github"];
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

type InviteRow = {
  id: string;
  agency_id: string;
  client_organization_id: string;
  project_id: string;
  website_id: string | null;
  recipient_email: string | null;
  status: string;
  allowed_methods: string[];
  github_installation_id: number | string | null;
  created_by: string;
  first_opened_at: string | null;
  completed_at: string | null;
  expires_at: string;
  last_error_code: string | null;
  created_at: string;
};

export type WebsiteConnectionInviteSummary = {
  id: string;
  projectName: string;
  domain: string;
  platform: string;
  status: string;
  allowedMethods: string[];
  expiresAt: string;
  firstOpenedAt: string | null;
  completedAt: string | null;
  needsRepositorySelection: boolean;
  repositories: Array<{ id: number; fullName: string; defaultBranch: string }>;
};

function tokenHash(token: string) {
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(token)) {
    throw new ApiError("This website setup link is invalid.", 400, "INVALID_STATE");
  }
  return createHash("sha256").update(token).digest("hex");
}

async function resolveInviteOwner(email: string, projectId: string) {
  const db = getLiveAdminClient();
  const profile = await db.from("profiles").select("id").ilike("email", email.toLowerCase()).maybeSingle();
  if (!profile.data?.id) throw new ApiError("Sign in before sharing website setup.", 401, "AUTH_REQUIRED");
  const project = await db.from("seo_projects").select("id,name,domain,agency_id,client_organization_id").eq("id", projectId).eq("status", "active").maybeSingle();
  if (!project.data) throw new ApiError("Client project not found.", 404, "NOT_FOUND");
  const [agencyMembership, clientMembership, website] = await Promise.all([
    db.from("agency_members").select("role").eq("user_id", profile.data.id).eq("agency_id", project.data.agency_id).eq("status", "active").maybeSingle(),
    db.from("client_members").select("role").eq("user_id", profile.data.id).eq("agency_id", project.data.agency_id).eq("client_organization_id", project.data.client_organization_id).eq("status", "active").maybeSingle(),
    db.from("websites").select("id,cms_type").eq("project_id", projectId).eq("is_primary", true).limit(1).maybeSingle(),
  ]);
  const agencyAllowed = agencyMembership.data && hasPermission(agencyMembership.data.role as AgencyRole, "integrations.manage");
  const clientAllowed = clientMembership.data?.role === "client_admin";
  if (!agencyAllowed && !clientAllowed) throw new ApiError("Only the business owner or an authorized agency manager can share website setup.", 403, "ROLE_FORBIDDEN");
  return { db, userId: profile.data.id, project: project.data, website: website.data };
}

async function sendInviteEmail(input: { id: string; to: string; domain: string; url: string; expiresAt: string }) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return "manual" as const;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "Idempotency-Key": `hdseo-website-handoff-${input.id}`,
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [input.to],
      subject: `Website access requested for ${input.domain}`,
      text: [
        `The owner of ${input.domain} asked you to connect their website to HD SEO.`,
        "",
        "This secure link only allows you to configure publishing access for this website. It does not provide access to billing, analytics, approvals, leads, or the owner's HD SEO account.",
        "",
        input.url,
        "",
        `The link expires ${new Date(input.expiresAt).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}.`,
        "If you were not expecting this request, ignore this email.",
      ].join("\n"),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    logServerError("website_connection_invite_email_failed", new Error(`Resend HTTP ${response.status}`), { projectId: input.id, provider: "resend", operation: "website_handoff" });
    return "failed" as const;
  }
  return "sent" as const;
}

export async function createWebsiteConnectionInvite(email: string, input: { projectId: string; recipientEmail?: string }) {
  const context = await resolveInviteOwner(email, input.projectId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS).toISOString();
  const now = new Date().toISOString();
  await context.db.from("website_connection_invites").update({ status: "revoked", updated_at: now }).eq("project_id", input.projectId).in("status", ACTIVE_STATUSES);
  const created = await context.db.from("website_connection_invites").insert({
    agency_id: context.project.agency_id,
    client_organization_id: context.project.client_organization_id,
    project_id: input.projectId,
    website_id: context.website?.id ?? null,
    token_hash: tokenHash(token),
    recipient_email: input.recipientEmail?.trim().toLowerCase() || null,
    allowed_methods: DEFAULT_METHODS,
    created_by: context.userId,
    expires_at: expiresAt,
  }).select("id").single();
  if (created.error || !created.data) throw new ApiError("The website setup link could not be created.", 500, "DATABASE_BINDING_FAILED");
  const url = new URL(`/connect/website/${token}`, `${appBaseUrl()}/`).toString();
  const delivery = input.recipientEmail
    ? await sendInviteEmail({ id: created.data.id, to: input.recipientEmail, domain: context.project.domain, url, expiresAt })
    : "manual" as const;
  await context.db.from("audit_events").insert({
    agency_id: context.project.agency_id,
    actor_user_id: context.userId,
    actor_type: "user",
    action: "website.connection_invite.created",
    resource_type: "website_connection_invite",
    resource_id: created.data.id,
    after_state: { projectId: input.projectId, expiresAt, delivery, recipientProvided: Boolean(input.recipientEmail) },
    metadata: { source: "client_portal" },
  });
  return { id: created.data.id as string, url, expiresAt, delivery };
}

async function loadInvite(token: string) {
  const db = getLiveAdminClient();
  const result = await db.from("website_connection_invites").select("id,agency_id,client_organization_id,project_id,website_id,recipient_email,status,allowed_methods,github_installation_id,created_by,first_opened_at,completed_at,expires_at,last_error_code,created_at").eq("token_hash", tokenHash(token)).maybeSingle();
  if (result.error) throw new ApiError("The website setup link could not be verified.", 500, "DATABASE_BINDING_FAILED");
  if (!result.data) throw new ApiError("This website setup link is invalid or has been replaced.", 404, "NOT_FOUND");
  const row = result.data as InviteRow;
  if (ACTIVE_STATUSES.includes(row.status) && new Date(row.expires_at).getTime() <= Date.now()) {
    await db.from("website_connection_invites").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", row.id);
    row.status = "expired";
  }
  if (["revoked", "expired"].includes(row.status)) throw new ApiError("This website setup link has expired or was replaced. Ask the business owner for a new link.", 410, "INVALID_STATE");
  const [project, website] = await Promise.all([
    db.from("seo_projects").select("id,name,domain,status").eq("id", row.project_id).eq("agency_id", row.agency_id).eq("client_organization_id", row.client_organization_id).maybeSingle(),
    row.website_id ? db.from("websites").select("cms_type").eq("id", row.website_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!project.data || project.data.status !== "active") throw new ApiError("The website project is no longer available.", 410, "INVALID_STATE");
  return { db, row, project: project.data, platform: website.data?.cms_type ?? "unknown" };
}

export async function inspectWebsiteConnectionInvite(token: string): Promise<WebsiteConnectionInviteSummary> {
  const loaded = await loadInvite(token);
  const now = new Date().toISOString();
  if (loaded.row.status === "pending") {
    await loaded.db.from("website_connection_invites").update({ status: "opened", first_opened_at: now, updated_at: now }).eq("id", loaded.row.id).eq("status", "pending");
    loaded.row.status = "opened";
    loaded.row.first_opened_at = now;
  }
  let repositories: WebsiteConnectionInviteSummary["repositories"] = [];
  if (loaded.row.github_installation_id && loaded.row.status !== "completed") {
    repositories = (await listInstallationRepositories(Number(loaded.row.github_installation_id))).map((repository) => ({ id: repository.id, fullName: repository.full_name, defaultBranch: repository.default_branch }));
  }
  return {
    id: loaded.row.id,
    projectName: loaded.project.name,
    domain: loaded.project.domain,
    platform: loaded.platform,
    status: loaded.row.status,
    allowedMethods: loaded.row.allowed_methods,
    expiresAt: loaded.row.expires_at,
    firstOpenedAt: loaded.row.first_opened_at,
    completedAt: loaded.row.completed_at,
    needsRepositorySelection: Boolean(loaded.row.github_installation_id) && loaded.row.status !== "completed",
    repositories,
  };
}

export async function resolveWebsiteConnectionInviteForGitHub(token: string) {
  const loaded = await loadInvite(token);
  if (loaded.row.status === "completed") throw new ApiError("This website connection has already been completed.", 409, "CONFLICT");
  if (!loaded.row.allowed_methods.includes("github")) throw new ApiError("GitHub is not authorized by this website setup link.", 403, "TENANT_DENIED");
  const context = await resolveDelegatedGitHubContext({
    agencyId: loaded.row.agency_id,
    clientId: loaded.row.client_organization_id,
    projectId: loaded.row.project_id,
    userId: loaded.row.created_by,
  });
  return { invite: loaded.row, context };
}

export async function completeWebsiteConnectionInvite(token: string, input: Omit<ConnectWebsiteInput, "projectId" | "portal">) {
  const loaded = await loadInvite(token);
  if (loaded.row.status === "completed") return { status: "completed" };
  if (!loaded.row.allowed_methods.includes(input.mode)) throw new ApiError("That connection method is not authorized by this setup link.", 403, "TENANT_DENIED");
  const claimed = await loaded.db.from("website_connection_invites").update({ status: "processing", updated_at: new Date().toISOString(), last_error_code: null }).eq("id", loaded.row.id).in("status", ["pending", "opened"]).select("id").maybeSingle();
  if (claimed.error || !claimed.data) throw new ApiError("This website setup link is already being used. Wait a moment and retry.", 409, "CONFLICT");
  try {
    const owner = await loaded.db.from("profiles").select("email").eq("id", loaded.row.created_by).maybeSingle();
    if (!owner.data?.email) throw new ApiError("The website owner authorization is no longer available.", 403, "TENANT_DENIED");
    await connectWebsite(owner.data.email, { ...input, projectId: loaded.row.project_id, portal: "client" });
    const completedAt = new Date().toISOString();
    await loaded.db.from("website_connection_invites").update({ status: "completed", completed_at: completedAt, updated_at: completedAt }).eq("id", loaded.row.id);
    return { status: "completed", completedAt };
  } catch (error) {
    await loaded.db.from("website_connection_invites").update({ status: "opened", last_error_code: error instanceof ApiError ? error.code : "OPERATION_FAILED", updated_at: new Date().toISOString() }).eq("id", loaded.row.id).eq("status", "processing");
    throw error;
  }
}

export async function recordWebsiteInviteGitHubResult(input: { inviteId: string; agencyId: string; projectId?: string; installationId: number; repositorySaved: boolean }) {
  const db = getLiveAdminClient();
  const invite = await db.from("website_connection_invites").select("id,project_id,status").eq("id", input.inviteId).eq("agency_id", input.agencyId).maybeSingle();
  if (!invite.data || (input.projectId && invite.data.project_id !== input.projectId)) throw new ApiError("The website setup handoff could not be matched to this project.", 403, "TENANT_DENIED");
  const now = new Date().toISOString();
  await db.from("website_connection_invites").update(input.repositorySaved
    ? { status: "completed", github_installation_id: input.installationId, completed_at: now, last_error_code: null, updated_at: now }
    : { status: "opened", github_installation_id: input.installationId, last_error_code: "REPOSITORY_SELECTION_REQUIRED", updated_at: now }
  ).eq("id", input.inviteId);
}

export async function selectWebsiteInviteRepository(token: string, repositoryId: number) {
  const loaded = await loadInvite(token);
  if (loaded.row.status === "completed") return { status: "completed" };
  if (!loaded.row.github_installation_id) throw new ApiError("Connect GitHub before selecting a repository.", 409, "INVALID_STATE");
  const context = await resolveDelegatedGitHubContext({ agencyId: loaded.row.agency_id, clientId: loaded.row.client_organization_id, projectId: loaded.row.project_id, userId: loaded.row.created_by });
  const repositories = await listInstallationRepositories(Number(loaded.row.github_installation_id));
  const repository = repositories.find((item) => item.id === repositoryId);
  if (!repository) throw new ApiError("That repository is not authorized for this GitHub installation.", 403, "REPOSITORY_NOT_AUTHORIZED");
  const installation = await loaded.db.from("github_installations").select("id").eq("installation_id", loaded.row.github_installation_id).eq("status", "active").maybeSingle();
  if (!installation.data) throw new ApiError("The verified GitHub installation is unavailable.", 409, "INSTALLATION_LOOKUP_FAILED");
  await saveRepositoryConnection(context, { installationRecordId: installation.data.id, installationId: Number(loaded.row.github_installation_id), repository });
  await upsertGitHubWebsite({ db: loaded.db, agencyId: loaded.row.agency_id, clientId: loaded.row.client_organization_id, projectId: loaded.row.project_id, projectName: loaded.project.name, domain: loaded.project.domain });
  const now = new Date().toISOString();
  await loaded.db.from("website_connection_invites").update({ status: "completed", completed_at: now, last_error_code: null, updated_at: now }).eq("id", loaded.row.id);
  return { status: "completed", repository: repository.full_name };
}
