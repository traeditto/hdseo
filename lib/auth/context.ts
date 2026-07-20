import "server-only";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api/errors";
import { hasPermission, type AgencyRole } from "./permissions";
import { requireAal2 } from "./mfa";

export interface TenantContext {
  user: { id: string; email: string };
  agency: { id: string; name: string; slug: string };
  client?: { id: string; name: string };
  project?: { id: string; name: string; domain: string };
  role: AgencyRole;
}

export type ClientRole = "client_admin" | "client_approver" | "client_viewer";

export interface ClientTenantContext {
  user: { id: string; email: string };
  agency: { id: string };
  client: { id: string; name: string };
  project?: { id: string; name: string; domain: string };
  role: ClientRole;
}

export async function resolveTenantContext(input: { agencyId?: string; clientId?: string; projectId?: string; requireProject?: boolean; requireAal2?: boolean } = {}): Promise<TenantContext> {
  const db = await createSupabaseServerClient();
  if (!db) throw new ApiError("Supabase is not configured.", 503, "NOT_CONFIGURED");
  const { data: { user } } = await db.auth.getUser();
  if (!user?.email) throw new ApiError("Authentication required.", 401, "AUTH_REQUIRED");
  if (input.requireAal2) await requireAal2(db);
  const store = await cookies();
  const agencyId = input.agencyId ?? store.get("hd_agency")?.value;
  let memberships = db.from("agency_members").select("agency_id,role,agencies(id,name,slug)").eq("user_id", user.id).eq("status", "active");
  if (agencyId) memberships = memberships.eq("agency_id", agencyId);
  const membershipResult = await memberships.limit(20);
  const membership = membershipResult.data?.[0];
  const agency = Array.isArray(membership?.agencies) ? membership.agencies[0] : membership?.agencies;
  if (!membership || !agency) throw new ApiError("Agency access denied.", 403, "TENANT_DENIED");
  const context: TenantContext = { user: { id: user.id, email: user.email }, agency, role: membership.role as AgencyRole };
  const clientId = input.clientId ?? store.get("hd_client")?.value;
  const projectId = input.projectId ?? store.get("hd_project")?.value;
  if (clientId || projectId || input.requireProject) {
    let projectQuery = db.from("seo_projects").select("id,name,domain,client_organization_id,client_organizations(id,name)").eq("agency_id", agency.id).eq("status", "active");
    if (projectId) projectQuery = projectQuery.eq("id", projectId);
    if (clientId) projectQuery = projectQuery.eq("client_organization_id", clientId);
    const projectResult = await projectQuery.limit(20);
    const project = projectResult.data?.[0];
    const client = Array.isArray(project?.client_organizations) ? project.client_organizations[0] : project?.client_organizations;
    if (!project || !client) throw new ApiError("Project access denied.", 403, "TENANT_DENIED");
    context.project = { id: project.id, name: project.name, domain: project.domain };
    context.client = client;
  }
  return context;
}

export function requirePermission(context: TenantContext, permission: string) {
  if (!hasPermission(context.role, permission)) throw new ApiError("Insufficient agency permission.", 403, "ROLE_FORBIDDEN");
}

export async function resolveClientContext(input: { clientId?: string; projectId?: string; requireProject?: boolean } = {}): Promise<ClientTenantContext> {
  const db = await createSupabaseServerClient();
  if (!db) throw new ApiError("Supabase is not configured.", 503, "NOT_CONFIGURED");
  const { data: { user } } = await db.auth.getUser();
  if (!user?.email) throw new ApiError("Authentication required.", 401, "AUTH_REQUIRED");
  const store = await cookies();
  const clientId = input.clientId ?? store.get("hd_client")?.value;
  let membershipQuery = db.from("client_members").select("agency_id,client_organization_id,role,client_organizations(id,name)").eq("user_id", user.id).eq("status", "active");
  if (clientId) membershipQuery = membershipQuery.eq("client_organization_id", clientId);
  const membership = (await membershipQuery.limit(1)).data?.[0];
  const client = Array.isArray(membership?.client_organizations) ? membership.client_organizations[0] : membership?.client_organizations;
  if (!membership || !client) throw new ApiError("Client access denied.", 403, "TENANT_DENIED");
  const context: ClientTenantContext = { user: { id: user.id, email: user.email }, agency: { id: membership.agency_id }, client, role: membership.role as ClientRole };
  const projectId = input.projectId ?? store.get("hd_project")?.value;
  if (projectId || input.requireProject) {
    let projectQuery = db.from("seo_projects").select("id,name,domain").eq("agency_id", membership.agency_id).eq("client_organization_id", client.id).eq("status", "active");
    if (projectId) projectQuery = projectQuery.eq("id", projectId);
    const project = (await projectQuery.limit(1)).data?.[0];
    if (!project) throw new ApiError("Project access denied.", 403, "TENANT_DENIED");
    context.project = project;
  }
  return context;
}

export function requireClientApproval(context: ClientTenantContext) {
  if (!(["client_admin", "client_approver"] as ClientRole[]).includes(context.role)) throw new ApiError("This client role cannot make approval decisions.", 403, "ROLE_FORBIDDEN");
}
