import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError } from "@/lib/api/errors";
import { hasPermission, type AgencyRole } from "@/lib/auth/permissions";
import { getLiveAdminClient, resolveLiveIdentity } from "@/lib/live/identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { IntegrationState } from "@/lib/security/signed-state";
import { requireAal2 } from "@/lib/auth/mfa";

export type GitHubManagementContext = {
  db: SupabaseClient;
  user: { id: string; email: string };
  agency: { id: string; name: string; slug: string };
  client?: { id: string; name: string };
  project?: { id: string; name: string; domain: string };
  platformAdmin: boolean;
  role: AgencyRole | "platform_admin";
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
  const agencyResult = await db.from("agencies").select("id,name,slug").eq("id", input.agencyId).eq("status", "active").single();
  if (!agencyResult.data) throw new ApiError("Agency access denied.", 403, "TENANT_DENIED");

  let role: AgencyRole | "platform_admin" = "platform_admin";
  if (!input.platformAdmin) {
    const membership = await db.from("agency_members").select("role").eq("agency_id", input.agencyId).eq("user_id", input.userId).eq("status", "active").maybeSingle();
    role = membership.data?.role as AgencyRole;
    if (!role || !hasPermission(role, "integrations.manage")) throw new ApiError("Insufficient agency permission.", 403, "ROLE_FORBIDDEN");
  }

  const context: GitHubManagementContext = { db, user:{id:input.userId,email:input.email}, agency:agencyResult.data, platformAdmin:input.platformAdmin, role };
  if (input.projectId || input.clientId) {
    let projectQuery = db.from("seo_projects").select("id,name,domain,client_organization_id,client_organizations(id,name)").eq("agency_id", input.agencyId).eq("status", "active");
    if (input.projectId) projectQuery = projectQuery.eq("id", input.projectId);
    if (input.clientId) projectQuery = projectQuery.eq("client_organization_id", input.clientId);
    const project = (await projectQuery.limit(1)).data?.[0];
    const client = Array.isArray(project?.client_organizations) ? project.client_organizations[0] : project?.client_organizations;
    if (!project || !client) throw new ApiError("Project access denied.", 403, "TENANT_DENIED");
    context.project = {id:project.id,name:project.name,domain:project.domain};
    context.client = client;
  }
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
  await requireAal2(session!);
  return authorizeAgency(db, {userId:user.id,email:user.email,agencyId:input.agencyId,platformAdmin:await platformAdmin(db,user.id),clientId:input.clientId,projectId:input.projectId});
}

export async function resolveSignedGitHubContext(state: IntegrationState) {
  const db = getLiveAdminClient();
  const profile = await db.from("profiles").select("email").eq("id", state.userId).single();
  if (!profile.data?.email) throw new ApiError("GitHub authorization user is unavailable.", 403, "TENANT_DENIED");
  return authorizeAgency(db, {userId:state.userId,email:profile.data.email,agencyId:state.agencyId,platformAdmin:await platformAdmin(db,state.userId),clientId:state.clientId,projectId:state.projectId});
}
