import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError } from "@/lib/api/errors";
import {
  getLiveAdminClient,
  resolveLiveIdentity,
  LiveConfigError,
} from "@/lib/live/identity";
import { buildManualPackage } from "@/lib/seo/manual-package";

/**
 * The portal store used to be backed by a Cloudflare D1 database. It now reads
 * and writes the shared Supabase Postgres schema through the service-role
 * client. The exported function names and their camelCase return shapes are
 * preserved so the portal dashboards keep working unchanged.
 *
 * The portal authenticates via ChatGPT headers (no Supabase session), so RLS
 * cannot be enforced through `auth.uid()`. Tenant scoping is instead enforced
 * explicitly in every query here via the resolved user id and membership rows.
 */

// ---------------------------------------------------------------------------
// Preserved return shapes
// ---------------------------------------------------------------------------

export type LiveUser = {
  email: string;
  displayName: string;
  platformRole: string | null;
};

export type LiveAgency = {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  createdAt: string;
};

export type LiveClient = {
  id: string;
  agencyId: string;
  name: string;
  domain: string;
  contactEmail: string | null;
  status: string;
  createdAt: string;
};

export type LiveProject = {
  id: string;
  agencyId: string;
  clientId: string;
  name: string;
  domain: string;
  status: string;
  createdAt: string;
};

export type LiveOpportunity = {
  id: string;
  agencyId: string;
  projectId: string;
  keyword: string;
  currentRank: number | null;
  targetRank: number;
  score: number;
  actionType: string;
  reason: string;
  status: string;
  createdAt: string;
};

export type LiveTask = {
  id: string;
  agencyId: string;
  projectId: string;
  opportunityId: string | null;
  title: string;
  status: string;
  priority: string;
  assignedEmail: string | null;
  implementationPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LivePackage = {
  id: string;
  agencyId: string;
  projectId: string;
  opportunityId: string;
  title: string;
  implementationPath: string;
  status: string;
  packageData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type LiveEvent = {
  id: string;
  agencyId: string;
  projectId: string | null;
  eventType: string;
  title: string;
  description: string | null;
  actorEmail: string;
  clientVisible: boolean;
  createdAt: string;
};

export type AgencyMembership = { agency: LiveAgency; role: string };

// ---------------------------------------------------------------------------
// Client-visible package statuses (portal vocabulary)
// ---------------------------------------------------------------------------

export const CLIENT_VISIBLE_PACKAGE_STATUSES = [
  "client_review",
  "client_approved",
  "implemented",
  "verified",
] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function admin(): SupabaseClient {
  return getLiveAdminClient();
}

function toIso(value: unknown): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function resolveUserId(
  db: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data } = await db
    .from("profiles")
    .select("id")
    .ilike("email", email.toLowerCase())
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function emailMap(
  db: SupabaseClient,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data } = await db
    .from("profiles")
    .select("id,email")
    .in("id", ids);
  for (const row of data ?? []) {
    if (row.email) map.set(row.id as string, row.email as string);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Row mappers (Postgres snake_case -> portal camelCase)
// ---------------------------------------------------------------------------

function mapAgency(row: Record<string, any>): LiveAgency {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerEmail: row.billing_email ?? "",
    createdAt: toIso(row.created_at),
  };
}

function mapClient(
  row: Record<string, any>,
  domainByOrg: Map<string, string>,
): LiveClient {
  return {
    id: row.id,
    agencyId: row.agency_id,
    name: row.name,
    domain: domainByOrg.get(row.id) ?? "",
    contactEmail: row.primary_contact_email ?? null,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

function mapProject(row: Record<string, any>): LiveProject {
  return {
    id: row.id,
    agencyId: row.agency_id,
    clientId: row.client_organization_id,
    name: row.name,
    domain: row.domain,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

function mapOpportunity(row: Record<string, any>): LiveOpportunity {
  const evidence = asRecord(row.evidence);
  const reasonFromCodes = Array.isArray(row.reason_codes)
    ? row.reason_codes.join(", ")
    : "";
  return {
    id: row.id,
    agencyId: row.agency_id,
    projectId: row.project_id,
    keyword: (evidence.keyword as string) ?? row.opportunity_key ?? "",
    currentRank:
      typeof evidence.current_rank === "number"
        ? (evidence.current_rank as number)
        : null,
    targetRank:
      typeof evidence.target_rank === "number"
        ? (evidence.target_rank as number)
        : 10,
    score: row.opportunity_score ?? 0,
    actionType: row.action_type,
    reason: (evidence.reason as string) ?? reasonFromCodes,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

function mapTask(row: Record<string, any>): LiveTask {
  const proof = asRecord(row.completion_proof);
  return {
    id: row.id,
    agencyId: row.agency_id,
    projectId: row.project_id,
    opportunityId: (proof.opportunity_id as string) ?? null,
    title: row.title,
    status: row.status,
    priority: row.priority,
    assignedEmail: (proof.assigned_email as string) ?? null,
    implementationPath: (proof.implementation_path as string) ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPackage(row: Record<string, any>): LivePackage {
  const data = asRecord(row.package_data);
  return {
    id: row.id,
    agencyId: row.agency_id,
    projectId: row.project_id,
    opportunityId: row.opportunity_id,
    title: (data.title as string) ?? "",
    implementationPath: row.implementation_path,
    status: row.status,
    packageData: data,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapEvent(
  row: Record<string, any>,
  emails: Map<string, string>,
): LiveEvent {
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    agencyId: row.agency_id,
    projectId: row.project_id ?? null,
    eventType: row.event_type,
    title: row.title,
    description: row.description ?? null,
    actorEmail:
      (metadata.actor_email as string) ??
      (row.actor_user_id ? emails.get(row.actor_user_id) ?? "" : ""),
    clientVisible: Boolean(row.client_visible),
    createdAt: toIso(row.occurred_at),
  };
}

async function domainByOrgMap(
  db: SupabaseClient,
  orgIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!orgIds.length) return map;
  const { data } = await db
    .from("seo_projects")
    .select("client_organization_id,domain,created_at")
    .in("client_organization_id", orgIds)
    .order("created_at", { ascending: true });
  for (const row of data ?? []) {
    if (!map.has(row.client_organization_id)) {
      map.set(row.client_organization_id, row.domain);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * No-op retained for backwards compatibility. The Supabase schema is managed
 * through migrations, so there is nothing to create at request time. It still
 * verifies that the service-role client is configured.
 */
export async function ensureLiveSchema(): Promise<void> {
  try {
    getLiveAdminClient();
  } catch (error) {
    if (error instanceof LiveConfigError) {
      throw new ApiError(error.message, 503, "NOT_CONFIGURED");
    }
    throw error;
  }
}

export async function upsertLiveUser(user: ChatGPTUser): Promise<LiveUser> {
  const db = admin();
  const identity = await resolveLiveIdentity(db, user);
  return {
    email: identity.email,
    displayName: identity.displayName,
    platformRole: identity.isPlatformAdmin ? "platform_owner" : null,
  };
}

export async function createAgencyForUser(
  email: string,
  name: string,
): Promise<string> {
  const db = admin();
  const userId = await resolveUserId(db, email);
  if (!userId) {
    throw new ApiError("Sign in before creating an agency.", 403, "TENANT_DENIED");
  }

  const slugBase =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "agency";

  const { data: agency, error } = await db
    .from("agencies")
    .insert({
      name,
      slug: `${slugBase}-${crypto.randomUUID().slice(0, 6)}`,
      billing_email: email,
    })
    .select("id")
    .single();

  if (error || !agency) {
    throw new ApiError(
      `Unable to create agency: ${error?.message ?? "unknown error"}`,
      500,
      "WRITE_FAILED",
    );
  }

  const { error: memberError } = await db.from("agency_members").insert({
    agency_id: agency.id,
    user_id: userId,
    role: "agency_owner",
    status: "active",
  });

  if (memberError) {
    throw new ApiError(
      `Unable to attach agency owner: ${memberError.message}`,
      500,
      "WRITE_FAILED",
    );
  }

  return agency.id as string;
}

export async function agencyMembership(
  email: string,
): Promise<AgencyMembership | null> {
  const db = admin();
  const userId = await resolveUserId(db, email);
  if (!userId) return null;

  const { data } = await db
    .from("agency_members")
    .select("role,agencies(id,name,slug,billing_email,created_at)")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!data?.agencies) return null;
  const agencyRow = Array.isArray(data.agencies)
    ? data.agencies[0]
    : data.agencies;
  if (!agencyRow) return null;

  return { agency: mapAgency(agencyRow), role: data.role as string };
}

export async function requireAgency(email: string): Promise<AgencyMembership> {
  const membership = await agencyMembership(email);
  if (!membership) {
    throw new ApiError(
      "Create or join an agency workspace first.",
      403,
      "TENANT_DENIED",
    );
  }
  return membership;
}

export async function liveAgencySnapshot(email: string) {
  const membership = await agencyMembership(email);
  if (!membership) {
    return {
      agency: null,
      role: null,
      clients: [] as LiveClient[],
      projects: [] as LiveProject[],
      opportunities: [] as LiveOpportunity[],
      tasks: [] as LiveTask[],
      packages: [] as LivePackage[],
      events: [] as LiveEvent[],
    };
  }

  const db = admin();
  const agencyId = membership.agency.id;

  const [
    clientsRes,
    projectsRes,
    opportunitiesRes,
    tasksRes,
    packagesRes,
    eventsRes,
  ] = await Promise.all([
    db
      .from("client_organizations")
      .select("*")
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false }),
    db
      .from("seo_projects")
      .select("*")
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false }),
    db
      .from("seo_opportunities")
      .select("*")
      .eq("agency_id", agencyId)
      .order("opportunity_score", { ascending: false }),
    db
      .from("seo_tasks")
      .select("*")
      .eq("agency_id", agencyId)
      .order("updated_at", { ascending: false }),
    db
      .from("implementation_packages")
      .select("*")
      .eq("agency_id", agencyId)
      .order("updated_at", { ascending: false }),
    db
      .from("proof_of_work_events")
      .select("*")
      .eq("agency_id", agencyId)
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);

  const clients = clientsRes.data ?? [];
  const domainByOrg = await domainByOrgMap(
    db,
    clients.map((row) => row.id),
  );
  const emails = await emailMap(
    db,
    (eventsRes.data ?? []).map((row) => row.actor_user_id),
  );

  return {
    agency: membership.agency,
    role: membership.role,
    clients: clients.map((row) => mapClient(row, domainByOrg)),
    projects: (projectsRes.data ?? []).map(mapProject),
    opportunities: (opportunitiesRes.data ?? []).map(mapOpportunity),
    tasks: (tasksRes.data ?? []).map(mapTask),
    packages: (packagesRes.data ?? []).map(mapPackage),
    events: (eventsRes.data ?? []).map((row) => mapEvent(row, emails)),
  };
}

export async function liveClientSnapshot(email: string) {
  const db = admin();
  const userId = await resolveUserId(db, email);
  if (!userId) {
    return {
      clients: [] as AgencyMembership["agency"][],
      projects: [] as LiveProject[],
      opportunities: [] as LiveOpportunity[],
      packages: [] as LivePackage[],
      events: [] as LiveEvent[],
    };
  }

  const { data: memberships } = await db
    .from("client_members")
    .select("role,client_organizations(*)")
    .eq("user_id", userId)
    .eq("status", "active");

  const matches = (memberships ?? [])
    .map((row) => {
      const org = Array.isArray(row.client_organizations)
        ? row.client_organizations[0]
        : row.client_organizations;
      return org ? { org, role: row.role as string } : null;
    })
    .filter(Boolean) as Array<{ org: Record<string, any>; role: string }>;

  if (!matches.length) {
    return {
      clients: [],
      projects: [] as LiveProject[],
      opportunities: [] as LiveOpportunity[],
      packages: [] as LivePackage[],
      events: [] as LiveEvent[],
    };
  }

  const orgIds = matches.map((match) => match.org.id);
  const domainByOrg = await domainByOrgMap(db, orgIds);

  const { data: projectRows } = await db
    .from("seo_projects")
    .select("*")
    .in("client_organization_id", orgIds);
  const projects = projectRows ?? [];
  const projectIds = projects.map((row) => row.id);

  const clients = matches.map((match) => ({
    client: mapClient(match.org, domainByOrg),
    role: match.role,
  }));

  if (!projectIds.length) {
    return {
      clients,
      projects: projects.map(mapProject),
      opportunities: [] as LiveOpportunity[],
      packages: [] as LivePackage[],
      events: [] as LiveEvent[],
    };
  }

  const [opportunitiesRes, packagesRes, eventsRes] = await Promise.all([
    db
      .from("seo_opportunities")
      .select("*")
      .in("project_id", projectIds)
      .order("opportunity_score", { ascending: false }),
    db
      .from("implementation_packages")
      .select("*")
      .in("project_id", projectIds)
      .in("status", [...CLIENT_VISIBLE_PACKAGE_STATUSES])
      .order("updated_at", { ascending: false }),
    db
      .from("proof_of_work_events")
      .select("*")
      .in("project_id", projectIds)
      .eq("client_visible", true)
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);

  const emails = await emailMap(
    db,
    (eventsRes.data ?? []).map((row) => row.actor_user_id),
  );

  return {
    clients,
    projects: projects.map(mapProject),
    opportunities: (opportunitiesRes.data ?? []).map(mapOpportunity),
    packages: (packagesRes.data ?? []).map(mapPackage),
    events: (eventsRes.data ?? []).map((row) => mapEvent(row, emails)),
  };
}

export async function liveAdminSnapshot(email: string) {
  const db = admin();
  const userId = await resolveUserId(db, email);
  if (!userId) {
    throw new ApiError(
      "Platform administration access denied.",
      403,
      "ROLE_FORBIDDEN",
    );
  }

  const { data: adminRow } = await db
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (!adminRow) {
    throw new ApiError(
      "Platform administration access denied.",
      403,
      "ROLE_FORBIDDEN",
    );
  }

  const [agenciesRes, clientsRes, projectsRes, profilesRes, adminsRes] =
    await Promise.all([
      db.from("agencies").select("*"),
      db.from("client_organizations").select("*"),
      db.from("seo_projects").select("*"),
      db.from("profiles").select("id,email,display_name"),
      db.from("platform_admins").select("user_id").eq("status", "active"),
    ]);

  const clients = clientsRes.data ?? [];
  const domainByOrg = await domainByOrgMap(
    db,
    clients.map((row) => row.id),
  );
  const adminIds = new Set(
    (adminsRes.data ?? []).map((row) => row.user_id as string),
  );

  return {
    agencies: (agenciesRes.data ?? []).map(mapAgency),
    clients: clients.map((row) => mapClient(row, domainByOrg)),
    projects: (projectsRes.data ?? []).map(mapProject),
    users: (profilesRes.data ?? []).map(
      (row): LiveUser => ({
        email: row.email ?? "",
        displayName: row.display_name ?? row.email ?? "",
        platformRole: adminIds.has(row.id) ? "platform_owner" : null,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

async function agencyContext(email: string): Promise<{
  db: SupabaseClient;
  agencyId: string;
  userId: string;
}> {
  const db = admin();
  const membership = await requireAgency(email);
  const userId = await resolveUserId(db, email);
  if (!userId) {
    throw new ApiError("Sign in before continuing.", 403, "TENANT_DENIED");
  }
  return { db, agencyId: membership.agency.id, userId };
}

async function recordEvent(
  db: SupabaseClient,
  event: {
    agencyId: string;
    clientOrganizationId: string;
    projectId: string;
    eventType: string;
    title: string;
    description?: string | null;
    actorUserId?: string | null;
    actorEmail?: string | null;
    clientVisible?: boolean;
  },
): Promise<void> {
  await db.from("proof_of_work_events").insert({
    agency_id: event.agencyId,
    client_organization_id: event.clientOrganizationId,
    project_id: event.projectId,
    event_type: event.eventType,
    title: event.title,
    description: event.description ?? null,
    actor_user_id: event.actorUserId ?? null,
    client_visible: event.clientVisible ?? false,
    metadata: event.actorEmail ? { actor_email: event.actorEmail } : {},
  });
}

export async function createClientWithProject(
  email: string,
  input: { name: string; domain: string; contactEmail?: string },
): Promise<void> {
  const { db, agencyId, userId } = await agencyContext(email);
  const cleanDomain = input.domain
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  const slugBase =
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "client";

  const { data: org, error } = await db
    .from("client_organizations")
    .insert({
      agency_id: agencyId,
      name: input.name,
      slug: `${slugBase}-${crypto.randomUUID().slice(0, 6)}`,
      primary_contact_email: input.contactEmail?.toLowerCase() || null,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !org) {
    throw new ApiError(
      `Unable to create client: ${error?.message ?? "unknown error"}`,
      500,
      "WRITE_FAILED",
    );
  }

  const { data: project, error: projectError } = await db
    .from("seo_projects")
    .insert({
      agency_id: agencyId,
      client_organization_id: org.id,
      name: "Primary SEO Project",
      domain: cleanDomain,
      canonical_domain: cleanDomain,
      status: "active",
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new ApiError(
      `Unable to create project: ${projectError?.message ?? "unknown error"}`,
      500,
      "WRITE_FAILED",
    );
  }

  // Auto-link the client contact to their organization if they already exist.
  if (input.contactEmail) {
    const contactUserId = await resolveUserId(db, input.contactEmail);
    if (contactUserId) {
      await db.from("client_members").upsert(
        {
          agency_id: agencyId,
          client_organization_id: org.id,
          user_id: contactUserId,
          role: "client_owner",
          status: "active",
        },
        { onConflict: "client_organization_id,user_id" },
      );
    }
  }

  await recordEvent(db, {
    agencyId,
    clientOrganizationId: org.id,
    projectId: project.id,
    eventType: "client_created",
    title: `${input.name} added`,
    description: `Primary SEO project created for ${cleanDomain}.`,
    actorUserId: userId,
    actorEmail: email,
    clientVisible: false,
  });
}

export async function createOpportunity(
  email: string,
  input: {
    projectId: string;
    keyword: string;
    currentRank?: number;
    targetRank: number;
    actionType: string;
    reason: string;
  },
): Promise<void> {
  const { db, agencyId } = await agencyContext(email);
  const { data: project } = await db
    .from("seo_projects")
    .select("id,client_organization_id")
    .eq("id", input.projectId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!project) throw new ApiError("Project not found.", 404, "NOT_FOUND");

  const proximity = input.currentRank
    ? Math.max(0, 45 - Math.abs(input.currentRank - input.targetRank) * 3)
    : 12;
  const actionValue = ["IMPROVE", "CTR_WIN", "TECHNICAL"].includes(
    input.actionType,
  )
    ? 24
    : 18;
  const score = Math.min(100, Math.max(1, proximity + actionValue + 20));

  const { error } = await db.from("seo_opportunities").insert({
    agency_id: agencyId,
    client_organization_id: project.client_organization_id,
    project_id: project.id,
    opportunity_score: score,
    confidence_score: input.currentRank ? 80 : 60,
    action_type: input.actionType,
    priority: score >= 80 ? "high" : score >= 60 ? "medium" : "low",
    target_milestone: `top_${input.targetRank}`,
    scoring_version: "manual-v1",
    opportunity_key: `${input.actionType}:${input.keyword.toLowerCase()}`,
    reason_codes: [input.actionType],
    evidence: {
      keyword: input.keyword,
      current_rank: input.currentRank ?? null,
      target_rank: input.targetRank,
      reason: input.reason,
    },
    status: "open",
  });

  if (error) {
    throw new ApiError(
      `Unable to create opportunity: ${error.message}`,
      500,
      "WRITE_FAILED",
    );
  }
}

export async function createPackage(
  email: string,
  input: { opportunityId: string; implementationPath: string },
): Promise<void> {
  const { db, agencyId, userId } = await agencyContext(email);
  const { data: opp } = await db
    .from("seo_opportunities")
    .select("*")
    .eq("id", input.opportunityId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!opp) throw new ApiError("Opportunity not found.", 404, "NOT_FOUND");

  const { data: project } = await db
    .from("seo_projects")
    .select("id,domain,client_organization_id")
    .eq("id", opp.project_id)
    .maybeSingle();
  if (!project) throw new ApiError("Project not found.", 404, "NOT_FOUND");

  const evidence = asRecord(opp.evidence);
  const keyword =
    (evidence.keyword as string) ?? (opp.opportunity_key as string) ?? "";
  const path = input.implementationPath as
    | "wordpress_package"
    | "generic_cms"
    | "developer_ticket";
  const packageData = buildManualPackage({
    path,
    keyword,
    targetUrl: `https://${project.domain}`,
    actionType: opp.action_type,
    verifiedEvidence: [],
    missingEvidence: ["Approved business claims and proof"],
  });

  const { data: latest } = await db
    .from("implementation_packages")
    .select("version")
    .eq("opportunity_id", input.opportunityId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((latest?.version as number) ?? 0) + 1;

  const { data: pkg, error } = await db
    .from("implementation_packages")
    .insert({
      agency_id: agencyId,
      client_organization_id: project.client_organization_id,
      project_id: project.id,
      opportunity_id: input.opportunityId,
      implementation_path: path,
      version,
      status: "agency_review",
      package_data: { ...packageData, title: `${keyword} implementation` },
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !pkg) {
    throw new ApiError(
      `Unable to create package: ${error?.message ?? "unknown error"}`,
      500,
      "WRITE_FAILED",
    );
  }

  await db.from("seo_tasks").insert({
    agency_id: agencyId,
    client_organization_id: project.client_organization_id,
    project_id: project.id,
    title: `Implement ${keyword}`,
    status: "awaiting_review",
    priority: (opp.opportunity_score as number) >= 80 ? "high" : "medium",
    created_by: userId,
    completion_proof: {
      opportunity_id: input.opportunityId,
      package_id: pkg.id,
      assigned_email: email,
      implementation_path: path,
    },
  });

  await recordEvent(db, {
    agencyId,
    clientOrganizationId: project.client_organization_id,
    projectId: project.id,
    eventType: "package_created",
    title: "Implementation package created",
    description: `${path.replaceAll("_", " ")} prepared for agency review.`,
    actorUserId: userId,
    actorEmail: email,
    clientVisible: false,
  });
}

export async function updateTaskStatus(
  email: string,
  input: { taskId: string; status: string },
): Promise<void> {
  const { db, agencyId } = await agencyContext(email);
  const { data, error } = await db
    .from("seo_tasks")
    .update({ status: input.status, updated_at: nowIso() })
    .eq("id", input.taskId)
    .eq("agency_id", agencyId)
    .select("id");
  if (error) {
    throw new ApiError(
      `Unable to update task: ${error.message}`,
      500,
      "WRITE_FAILED",
    );
  }
  if (!data || !data.length) {
    throw new ApiError("Task not found.", 404, "NOT_FOUND");
  }
}

export async function advancePackage(
  email: string,
  packageId: string,
  action: "publish_package" | "mark_implemented" | "verify_package",
): Promise<void> {
  const { db, agencyId, userId } = await agencyContext(email);
  const { data: pkg } = await db
    .from("implementation_packages")
    .select("*")
    .eq("id", packageId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!pkg) {
    throw new ApiError("Implementation package not found.", 404, "NOT_FOUND");
  }

  const status =
    action === "publish_package"
      ? "client_review"
      : action === "mark_implemented"
        ? "implemented"
        : "verified";
  const title =
    action === "publish_package"
      ? "Client approval requested"
      : action === "mark_implemented"
        ? "Implementation reported"
        : "Implementation verified";

  const patch: Record<string, unknown> = { status, updated_at: nowIso() };
  if (action === "mark_implemented") patch.implemented_at = nowIso();

  await db.from("implementation_packages").update(patch).eq("id", packageId);

  await recordEvent(db, {
    agencyId,
    clientOrganizationId: pkg.client_organization_id,
    projectId: pkg.project_id,
    eventType: action,
    title,
    description:
      action === "verify_package"
        ? "Verification recorded. Monitoring checkpoints are now eligible."
        : "Workflow status updated.",
    actorUserId: userId,
    actorEmail: email,
    clientVisible: true,
  });
}

export async function recordClientPackageDecision(
  email: string,
  input: { packageId: string; decision: string },
): Promise<void> {
  const db = admin();
  const userId = await resolveUserId(db, email);
  if (!userId) {
    throw new ApiError("Client approval access denied.", 403, "TENANT_DENIED");
  }

  const { data: pkg } = await db
    .from("implementation_packages")
    .select("*")
    .eq("id", input.packageId)
    .maybeSingle();
  if (!pkg) {
    throw new ApiError("Implementation package not found.", 404, "NOT_FOUND");
  }

  const { data: member } = await db
    .from("client_members")
    .select("id")
    .eq("user_id", userId)
    .eq("client_organization_id", pkg.client_organization_id)
    .eq("status", "active")
    .maybeSingle();
  if (!member) {
    throw new ApiError("Client approval access denied.", 403, "TENANT_DENIED");
  }

  await db
    .from("implementation_packages")
    .update({ status: input.decision, updated_at: nowIso() })
    .eq("id", input.packageId);

  await recordEvent(db, {
    agencyId: pkg.agency_id,
    clientOrganizationId: pkg.client_organization_id,
    projectId: pkg.project_id,
    eventType: input.decision,
    title: `Client ${input.decision.replaceAll("_", " ")}`,
    description: "The client decision was recorded through the secure portal.",
    actorUserId: userId,
    actorEmail: email,
    clientVisible: true,
  });
}
