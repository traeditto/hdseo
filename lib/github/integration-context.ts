import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError } from "@/lib/api/errors";
import { hasPermission, type AgencyRole } from "@/lib/auth/permissions";
import { getLiveAdminClient, resolveLiveIdentity } from "@/lib/live/identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { IntegrationState } from "@/lib/security/signed-state";

export type GitHubManagementContext = {
  db: SupabaseClient;
  user: { id: string; email: string };
  agency: { id: string; name: string; slug: string };
  client?: { id: string; name: string };
  project?: { id: string; name: string; domain: string };
  platformAdmin: boolean;
  role: AgencyRole | "platform_admin" | "client_admin";
};

async function platformAdmin(db: SupabaseClient, userId: string) {
  const result = await db
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(result.data);
}

async function authorizeAgency(
  db: SupabaseClient,
  input: { userId: string; email: string; agencyId: string; platformAdmin: boolean; clientId?: string; projectId?: string },
): Promise<GitHubManagementContext> {
  const agencyResult = await db
    .from("agencies")
    .select("id,name,slug,status")
    .eq("id", input.agencyId)
    .maybeSingle();
  if (!agencyResult.data) throw new ApiError("Agency access denied.", 403, "TENANT_DENIED");
  if (!["trial", "active"].includes(agencyResult.data.status)) {
    throw new ApiError("This workspace is not currently allowed to connect integrations.", 403, "TENANT_DENIED");
  }

  let projectContext: GitHubManagementContext["project"];
  let clientContext: GitHubManagementContext["client"];
  if (input.projectId || input.clientId) {
    let projectQuery = db.from("seo_projects").select("id,name,domain,client_organization_id,client_organizations(id,name)").eq("agency_id", input.agencyId).eq("status", "active");
    if (input.projectId) projectQuery = projectQuery.eq("id", input.projectId);
    if (input.clientId) projectQuery = projectQuery.eq("client_organization_id", input.clientId);
    const project = (await projectQuery.limit(1)).data?.[0];
    const client = Array.isArray(project?.client_organizations) ? project.client_organizations[0] : project?.client_organizations;
    if (!project || !client) throw new ApiError("Project access denied.", 403, "TENANT_DENIED");
    projectContext = {id:project.id,name:project.name,domain:project.domain};
    clientContext = client;
  }

  let role: GitHubManagementContext["role"] = "platform_admin";
  if (!input.platformAdmin) {
    const membership = await db.from("agency_members").select("role").eq("agency_id", input.agencyId).eq("user_id", input.userId).eq("status", "active").maybeSingle();
    const agencyRole = membership.data?.role as AgencyRole | undefined;
    if (agencyRole && hasPermission(agencyRole, "integrations.manage")) {
      role = agencyRole;
    } else {
      if (!clientContext || !projectContext) {
        throw new ApiError("Insufficient agency permission.", 403, "ROLE_FORBIDDEN");
      }
      const clientMembership = await db
        .from("client_members")
        .select("role")
        .eq("agency_id", input.agencyId)
        .eq("client_organization_id", clientContext.id)
        .eq("user_id", input.userId)
        .eq("status", "active")
        .maybeSingle();
      if (clientMembership.data?.role !== "client_admin") {
        throw new ApiError("Only the business owner can connect this website repository.", 403, "ROLE_FORBIDDEN");
      }
      role = "client_admin";
    }
  }

  const context: GitHubManagementContext = {
    db,
    user:{id:input.userId,email:input.email},
    agency:{id:agencyResult.data.id,name:agencyResult.data.name,slug:agencyResult.data.slug},
    platformAdmin:input.platformAdmin,
    role,
    ...(projectContext ? { project: projectContext } : {}),
    ...(clientContext ? { client: clientContext } : {}),
  };
  return context;
}

export async function resolveGitHubManagementContext(input: { agencyId: string; clientId?: string; projectId?: string }) {
  const db = getLiveAdminClient();
  const chatUser = await getChatGPTUser();
  if (chatUser) {
    const identity = await resolveLiveIdentity(db, chatUser);
    return authorizeAgency(db, {userId:identity.userId,email:identity.email,agencyId:input.agencyId,platformAdmin:identity.isPlatformAdmin,clientId:input.clientId,projectId:input.projectId});
  }

  const session = await createSupabaseServerClient();
  const user = session ? (await session.auth.getUser()).data.user : null;
  if (!user?.email) throw new ApiError("Authentication required.", 401, "AUTH_REQUIRED");
  return authorizeAgency(db, {userId:user.id,email:user.email,agencyId:input.agencyId,platformAdmin:await platformAdmin(db,user.id),clientId:input.clientId,projectId:input.projectId});
}

export async function resolveSignedGitHubContext(state: IntegrationState) {
  const db = getLiveAdminClient();
  const profile = await db.from("profiles").select("email").eq("id", state.userId).single();
  if (!profile.data?.email) throw new ApiError("GitHub authorization user is unavailable.", 403, "TENANT_DENIED");
  return authorizeAgency(db, {userId:state.userId,email:profile.data.email,agencyId:state.agencyId,platformAdmin:await platformAdmin(db,state.userId),clientId:state.clientId,projectId:state.projectId});
}
