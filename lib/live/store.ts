import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError } from "@/lib/api/errors";
import {
  getLiveAdminClient,
  resolveLiveIdentity,
  LiveConfigError,
} from "@/lib/live/identity";
import { env, hasDataForSeoConfig } from "@/lib/config/env";
import type { TenantContext } from "@/lib/auth/context";
import type { AgencyRole } from "@/lib/auth/permissions";
import { dataForSeoRequest } from "@/lib/providers/dataforseo/client";
import { providerOperations } from "@/lib/providers/dataforseo/operations";
import {
  beginPaidOperation,
  finishPaidOperation,
  paidScopeHash,
} from "@/lib/providers/paid-operation";
import {
  countDiscoveredKeywordRecords,
  discoverKeywordCandidates,
} from "@/lib/seo/keyword-discovery";
import { opportunityKey } from "@/lib/seo/eligibility";
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
  searchVolume: number | null;
  cpc: number | null;
  difficulty: number | null;
  estimatedMonthlyValue: number | null;
  estimatedEffort: number | null;
  valuePerDollar: number | null;
  source: string;
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

type DatabaseRow = Record<string, unknown>;

const rowText = (row: DatabaseRow, key: string, fallback = "") =>
  typeof row[key] === "string" ? (row[key] as string) : fallback;

function mapAgency(row: DatabaseRow): LiveAgency {
  return {
    id: rowText(row, "id"),
    name: rowText(row, "name"),
    slug: rowText(row, "slug"),
    ownerEmail: rowText(row, "billing_email"),
    createdAt: toIso(row.created_at),
  };
}

function mapClient(
  row: DatabaseRow,
  domainByOrg: Map<string, string>,
): LiveClient {
  return {
    id: rowText(row, "id"),
    agencyId: rowText(row, "agency_id"),
    name: rowText(row, "name"),
    domain: domainByOrg.get(rowText(row, "id")) ?? "",
    contactEmail: rowText(row, "primary_contact_email") || null,
    status: rowText(row, "status"),
    createdAt: toIso(row.created_at),
  };
}

function mapProject(row: DatabaseRow): LiveProject {
  return {
    id: rowText(row, "id"),
    agencyId: rowText(row, "agency_id"),
    clientId: rowText(row, "client_organization_id"),
    name: rowText(row, "name"),
    domain: rowText(row, "domain"),
    status: rowText(row, "status"),
    createdAt: toIso(row.created_at),
  };
}

function mapOpportunity(row: DatabaseRow): LiveOpportunity {
  const evidence = asRecord(row.evidence);
  const reasonFromCodes = Array.isArray(row.reason_codes)
    ? row.reason_codes.join(", ")
    : "";
  return {
    id: rowText(row, "id"),
    agencyId: rowText(row, "agency_id"),
    projectId: rowText(row, "project_id"),
    keyword:
      (evidence.keyword as string) ?? rowText(row, "opportunity_key"),
    currentRank:
      typeof evidence.current_rank === "number"
        ? (evidence.current_rank as number)
        : null,
    targetRank:
      typeof evidence.target_rank === "number"
        ? (evidence.target_rank as number)
        : 10,
    score:
      typeof row.opportunity_score === "number" ? row.opportunity_score : 0,
    actionType: rowText(row, "action_type"),
    reason: (evidence.reason as string) ?? reasonFromCodes,
    status: rowText(row, "status"),
    searchVolume:
      typeof evidence.search_volume === "number" ? evidence.search_volume : null,
    cpc: typeof evidence.cpc === "number" ? evidence.cpc : null,
    difficulty:
      typeof evidence.keyword_difficulty === "number"
        ? evidence.keyword_difficulty
        : null,
    estimatedMonthlyValue:
      typeof evidence.estimated_monthly_value === "number"
        ? evidence.estimated_monthly_value
        : null,
    estimatedEffort:
      typeof evidence.estimated_effort === "number"
        ? evidence.estimated_effort
        : null,
    valuePerDollar:
      typeof evidence.value_per_dollar === "number"
        ? evidence.value_per_dollar
        : null,
    source: (evidence.source as string) ?? "manual",
    createdAt: toIso(row.created_at),
  };
}

function mapTask(row: DatabaseRow): LiveTask {
  const proof = asRecord(row.completion_proof);
  return {
    id: rowText(row, "id"),
    agencyId: rowText(row, "agency_id"),
    projectId: rowText(row, "project_id"),
    opportunityId: (proof.opportunity_id as string) ?? null,
    title: rowText(row, "title"),
    status: rowText(row, "status"),
    priority: rowText(row, "priority"),
    assignedEmail: (proof.assigned_email as string) ?? null,
    implementationPath: (proof.implementation_path as string) ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPackage(row: DatabaseRow): LivePackage {
  const data = asRecord(row.package_data);
  return {
    id: rowText(row, "id"),
    agencyId: rowText(row, "agency_id"),
    projectId: rowText(row, "project_id"),
    opportunityId: rowText(row, "opportunity_id"),
    title: (data.title as string) ?? "",
    implementationPath: rowText(row, "implementation_path"),
    status: rowText(row, "status"),
    packageData: data,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapEvent(
  row: DatabaseRow,
  emails: Map<string, string>,
): LiveEvent {
  const metadata = asRecord(row.metadata);
  return {
    id: rowText(row, "id"),
    agencyId: rowText(row, "agency_id"),
    projectId: rowText(row, "project_id") || null,
    eventType: rowText(row, "event_type"),
    title: rowText(row, "title"),
    description: rowText(row, "description") || null,
    actorEmail:
      (metadata.actor_email as string) ??
      (row.actor_user_id
        ? emails.get(String(row.actor_user_id)) ?? ""
        : ""),
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
      "OPERATION_FAILED",
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
      "OPERATION_FAILED",
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
    .filter(Boolean) as Array<{ org: DatabaseRow; role: string }>;

  if (!matches.length) {
    return {
      clients: [],
      projects: [] as LiveProject[],
      opportunities: [] as LiveOpportunity[],
      packages: [] as LivePackage[],
      events: [] as LiveEvent[],
    };
  }

  const orgIds = matches.map((match) => rowText(match.org, "id"));
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
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
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
      "OPERATION_FAILED",
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
      "OPERATION_FAILED",
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
      "OPERATION_FAILED",
    );
  }
}

export type KeywordDiscoverySummary = {
  analyzed: number;
  selected: number;
  providerCost: number;
  monthlyBudget: number;
};

export async function discoverKeywordOpportunities(
  email: string,
  input: {
    projectId: string;
    monthlyBudget: number;
    targetMarket: string;
    limit: number;
  },
): Promise<KeywordDiscoverySummary> {
  if (!hasDataForSeoConfig) {
    throw new ApiError(
      "Keyword discovery needs the DataForSEO connection configured by an administrator.",
      503,
      "NOT_CONFIGURED",
    );
  }

  const { db, agencyId, userId } = await agencyContext(email);
  const membership = await requireAgency(email);
  const { data: project } = await db
    .from("seo_projects")
    .select(
      "id,name,domain,client_organization_id,country_code,language_code,client_organizations(name)",
    )
    .eq("id", input.projectId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!project) throw new ApiError("Project not found.", 404, "NOT_FOUND");

  const clientRow = Array.isArray(project.client_organizations)
    ? project.client_organizations[0]
    : project.client_organizations;
  const limit = Math.min(env.MAX_KEYWORDS_PER_RUN, input.limit);
  const discoveryDomain = project.domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const operation = "keyword_discovery" as const;
  const scope = {
    operation,
    sources: ["keywords_for_site", "ranked_keywords"],
    keywords: null,
    target: discoveryDomain,
    limit,
    locationName: input.targetMarket,
    languageCode: project.language_code || "en",
  };
  const estimatedCost = Number(
    (
      (providerOperations[operation].estimateUnitCost +
        providerOperations.ranked_keywords.estimateUnitCost) *
      limit
    ).toFixed(4),
  );
  const scopeHash = paidScopeHash(scope);
  const { data: confirmation, error: confirmationError } = await db
    .from("provider_operation_confirmations")
    .insert({
      agency_id: agencyId,
      client_organization_id: project.client_organization_id,
      project_id: project.id,
      provider: "dataforseo",
      operation_type: operation,
      requested_by: userId,
      estimated_units: limit,
      estimated_cost: estimatedCost,
      scope,
      scope_hash: scopeHash,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (confirmationError || !confirmation) {
    throw new ApiError(
      `Unable to authorize keyword discovery: ${confirmationError?.message ?? "unknown error"}`,
      500,
      "OPERATION_FAILED",
    );
  }

  const context: TenantContext = {
    user: { id: userId, email },
    agency: {
      id: agencyId,
      name: membership.agency.name,
      slug: membership.agency.slug,
    },
    client: {
      id: project.client_organization_id,
      name: clientRow?.name ?? project.name,
    },
    project: { id: project.id, name: project.name, domain: project.domain },
    role: membership.role as AgencyRole,
  };

  let paid: Awaited<ReturnType<typeof beginPaidOperation>> | null = null;
  try {
    paid = await beginPaidOperation(context, {
      confirmationId: confirmation.id,
      operation,
      estimatedUnits: limit,
      estimatedCost,
      scopeHash,
    });
    const providerInput = {
      target: discoveryDomain,
      limit,
      locationName: input.targetMarket,
      languageCode: project.language_code || "en",
    };
    const [siteResult, rankedResult] = await Promise.all([
      dataForSeoRequest<unknown>(
        providerOperations[operation].endpoint,
        providerOperations[operation].payload(providerInput),
        `automated-keyword-discovery:${paid.usageId}:site`,
      ),
      dataForSeoRequest<unknown>(
        providerOperations.ranked_keywords.endpoint,
        providerOperations.ranked_keywords.payload(providerInput),
        `automated-keyword-discovery:${paid.usageId}:ranked`,
      ),
    ]);
    const providerResults = [...siteResult.results, ...rankedResult.results];
    const providerCost = siteResult.totalCost + rankedResult.totalCost;
    const candidates = discoverKeywordCandidates(
      providerResults,
      input.monthlyBudget,
      Math.min(25, limit),
    );
    const analyzed = countDiscoveredKeywordRecords(providerResults);

    const { data: existingKeywords } = await db
      .from("seo_keywords")
      .select("id,normalized_keyword")
      .eq("project_id", project.id);
    const keywordIds = new Map(
      (existingKeywords ?? []).map((row) => [row.normalized_keyword, row.id]),
    );
    const missingKeywords = candidates
      .filter((candidate) => !keywordIds.has(candidate.normalizedKeyword))
      .map((candidate) => ({
        agency_id: agencyId,
        client_organization_id: project.client_organization_id,
        project_id: project.id,
        keyword: candidate.keyword,
        normalized_keyword: candidate.normalizedKeyword,
        intent: candidate.intent,
        commercial_intent_score: candidate.commercialIntentScore,
        target_url: candidate.rankingUrl,
        priority: candidate.opportunityScore,
        status: "active",
      }));
    if (missingKeywords.length) {
      const { data: inserted, error } = await db
        .from("seo_keywords")
        .insert(missingKeywords)
        .select("id,normalized_keyword");
      if (error) throw error;
      for (const row of inserted ?? []) {
        keywordIds.set(row.normalized_keyword, row.id);
      }
    }

    await Promise.all(
      candidates
        .filter((candidate) => keywordIds.has(candidate.normalizedKeyword))
        .map((candidate) =>
          db
            .from("seo_keywords")
            .update({
              intent: candidate.intent,
              commercial_intent_score: candidate.commercialIntentScore,
              target_url: candidate.rankingUrl,
              priority: candidate.opportunityScore,
              status: "active",
              updated_at: nowIso(),
            })
            .eq("id", keywordIds.get(candidate.normalizedKeyword)),
        ),
    );

    if (candidates.length) {
      const metricRows = candidates.map((candidate) => ({
        agency_id: agencyId,
        client_organization_id: project.client_organization_id,
        project_id: project.id,
        keyword_id: keywordIds.get(candidate.normalizedKeyword),
        keyword: candidate.keyword,
        search_volume: candidate.searchVolume,
        cpc: candidate.cpc,
        keyword_difficulty: candidate.difficulty,
        search_intent: candidate.intent,
        source: "dataforseo_domain_discovery",
        raw_response: {
          estimated_monthly_value: candidate.estimatedMonthlyValue,
          estimated_effort: candidate.estimatedEffort,
          value_per_dollar: candidate.valuePerDollar,
        },
      }));
      const rankingRows = candidates.filter((candidate)=>candidate.currentRank!=null).map((candidate) => ({
        agency_id: agencyId,
        client_organization_id: project.client_organization_id,
        project_id: project.id,
        keyword_id: keywordIds.get(candidate.normalizedKeyword),
          position: candidate.currentRank,
        ranking_url: candidate.rankingUrl,
        search_engine: "google",
        device: "desktop",
        location_code: input.targetMarket,
        collected_at: nowIso(),
      }));
      const metricWrite = await db
        .from("keyword_metric_snapshots")
        .insert(metricRows);
      if (metricWrite.error) throw metricWrite.error;
      if (rankingRows.length) {
        const rankingWrite = await db
          .from("organic_ranking_snapshots")
          .insert(rankingRows);
        if (rankingWrite.error) throw rankingWrite.error;
      }
    }

    const { data: activeOpportunities } = await db
      .from("seo_opportunities")
      .select("id,opportunity_key")
      .eq("project_id", project.id)
      .in("status", ["open", "approved", "in_progress", "monitoring"]);
    const opportunityIds = new Map(
      (activeOpportunities ?? []).map((row) => [row.opportunity_key, row.id]),
    );
    for (const candidate of candidates) {
      const key = opportunityKey(
        project.id,
        candidate.keyword,
        candidate.rankingUrl,
        candidate.actionType,
      );
      const reason = `HD SEO found this from ${project.domain}: ${candidate.searchVolume.toLocaleString()} monthly searches, $${candidate.cpc.toFixed(2)} CPC, ${candidate.currentRank == null ? "an untapped keyword" : `current rank #${candidate.currentRank}`}, and an estimated ${candidate.valuePerDollar.toFixed(2)} value-to-effort ratio within the $${input.monthlyBudget.toLocaleString()} monthly SEO budget.`;
      const values = {
        agency_id: agencyId,
        client_organization_id: project.client_organization_id,
        project_id: project.id,
        keyword_id: keywordIds.get(candidate.normalizedKeyword),
        opportunity_score: candidate.opportunityScore,
        confidence_score: candidate.confidenceScore,
        action_type: candidate.actionType,
        priority: candidate.priority,
        target_milestone: candidate.targetMilestone,
        reason_codes: candidate.reasonCodes,
        evidence: {
          keyword: candidate.keyword,
          current_rank: candidate.currentRank,
          target_rank: candidate.targetRank,
          ranking_url: candidate.rankingUrl,
          search_volume: candidate.searchVolume,
          cpc: candidate.cpc,
          keyword_difficulty: candidate.difficulty,
          search_intent: candidate.intent,
          estimated_monthly_value: candidate.estimatedMonthlyValue,
          estimated_effort: candidate.estimatedEffort,
          value_per_dollar: candidate.valuePerDollar,
          monthly_budget: input.monthlyBudget,
          target_market: input.targetMarket,
          source: "dataforseo_domain_discovery",
          reason,
          disclaimer:
            "Value and effort figures are directional prioritization estimates, not revenue guarantees.",
        },
        recommended_actions: candidate.recommendedActions,
        scoring_version: "automated-value-v1",
        opportunity_key: key,
        target_url: candidate.rankingUrl,
        updated_at: nowIso(),
      };
      const opportunityId = opportunityIds.get(key);
      const write = opportunityId
        ? await db.from("seo_opportunities").update(values).eq("id", opportunityId)
        : await db.from("seo_opportunities").insert({ ...values, status: "open" });
      if (write.error) throw write.error;
    }

    const { data: campaign } = await db
      .from("seo_campaigns")
      .select("id")
      .eq("project_id", project.id)
      .in("status", ["draft", "active", "paused", "budget_paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const campaignValues = {
      monthly_budget: input.monthlyBudget,
      implementation_budget: input.monthlyBudget,
      data_budget: Math.min(25, Math.max(1, input.monthlyBudget * 0.01)),
      automation_mode: "PREPARE",
      status: "active",
      constraints: {
        target_market: input.targetMarket,
        discovery_limit: limit,
        human_approval_required: true,
      },
      updated_at: nowIso(),
    };
    const campaignWrite = campaign
      ? await db.from("seo_campaigns").update(campaignValues).eq("id", campaign.id)
      : await db.from("seo_campaigns").insert({
          ...campaignValues,
          agency_id: agencyId,
          client_organization_id: project.client_organization_id,
          project_id: project.id,
          name: `${project.name} SEO Value Plan`,
          reserve_budget: 0,
          created_by: userId,
        });
    if (campaignWrite.error) throw campaignWrite.error;

    await db
      .from("seo_projects")
      .update({
        data_readiness_status: candidates.length ? "ready" : "needs_data",
        updated_at: nowIso(),
      })
      .eq("id", project.id);
    await recordEvent(db, {
      agencyId,
      clientOrganizationId: project.client_organization_id,
      projectId: project.id,
      eventType: "keyword_discovery_completed",
      title: `${candidates.length} high-value keywords discovered`,
      description: `HD SEO analyzed ${analyzed} site-relevant keyword records and prioritized the strongest opportunities for a $${input.monthlyBudget.toLocaleString()} monthly budget.`,
      actorUserId: userId,
      actorEmail: email,
      clientVisible: false,
    });

    await finishPaidOperation(paid, {
      cost: providerCost,
      units: analyzed,
      status: "completed",
    });
    paid = null;
    return {
      analyzed,
      selected: candidates.length,
      providerCost,
      monthlyBudget: input.monthlyBudget,
    };
  } catch (error) {
    if (paid) {
      await finishPaidOperation(paid, {
        cost: 0,
        units: 0,
        status: "failed",
        error: error instanceof Error ? error.message : "Keyword discovery failed",
      }).catch(() => undefined);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      `Keyword discovery failed: ${error instanceof Error ? error.message : "unknown error"}`,
      500,
      "OPERATION_FAILED",
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
      "OPERATION_FAILED",
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
      "OPERATION_FAILED",
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
