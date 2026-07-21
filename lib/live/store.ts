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
import {
  hasPermission,
  permissionMatrix,
  type AgencyRole,
} from "@/lib/auth/permissions";
import { dataForSeoRequest } from "@/lib/providers/dataforseo/client";
import { providerOperations } from "@/lib/providers/dataforseo/operations";
import { resolveLabsLocation } from "@/lib/providers/dataforseo/locations";
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
import {
  loadProjectServiceAreaPolicy,
  quarantineOutOfAreaKeywords,
} from "@/lib/seo/service-area-server";
import { assessKeywordServiceArea } from "@/lib/seo/service-area";
import { buildManualPackage } from "@/lib/seo/manual-package";
import type { ImplementationChoice } from "@/lib/seo/implementation-options";
import { createManualPackage } from "@/lib/manual/package-service";
import { verifyLiveImplementation } from "@/lib/manual/live-verification";
import { enqueueEvidenceJob } from "@/lib/evidence/queue";
import {
  detectWebsitePlatform,
  type WebsitePlatformAnalysis,
} from "@/lib/websites/platform-detection";
import {
  resumeEvidenceBlockedAgentWork,
  seedOnboardingAgentTeam,
} from "@/lib/agents/control-plane";
import { requestManagedAgentServiceCycle } from "@/lib/agent-service/service";
import { runManagedAgentCycle } from "@/lib/agent-service/scheduler";
import { wakeManagedAgentService } from "@/lib/agent-service/wake";
import {
  publishCmsPackage,
  rollbackCmsPublication,
} from "@/lib/websites/publishing";
import {implementationPackageDigest,implementationPackageSnapshot} from "@/lib/safety/package-approval";
import {claimWebsiteCrawlAccess,markTrialCrawlQueued,releaseTrialCrawlClaim} from "@/lib/trials/crawl-entitlement";

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
  repositoryExecutionEnabled: boolean;
  createdAt: string;
};

export type LiveImplementationReadiness = {
  projectId: string;
  cmsProvider: "wordpress" | "shopify" | "webflow" | null;
  cmsReady: boolean;
  repositoryConnected: boolean;
  repositoryReady: boolean;
  repositoryBlockers: string[];
  vercelConnected: boolean;
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
  marketScope: "service_area" | "nationwide";
  createdAt: string;
};

export type LiveWebsite = {
  id: string;
  projectId: string;
  name: string;
  siteUrl: string;
  canonicalDomain: string;
  cmsType: string;
  status: string;
  lastVerifiedAt: string | null;
  connectionId: string | null;
  connectionMode: string | null;
  connectionStatus: string | null;
  editorMode: string | null;
  googleSearchConsole: {
    id: string;
    status: string;
    selectedProperty: string | null;
    lastSyncedAt: string | null;
    lastVerifiedAt: string | null;
    properties: Array<{ siteUrl: string; permissionLevel?: string }>;
    health: string;
  } | null;
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
  publicationId: string | null;
  publicationStatus: string | null;
  publicationProvider: string | null;
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

export type LiveCampaignJob = {
  id: string;
  projectId: string;
  status: string;
  currentStage: string;
  progressPercent: number;
  errorMessage: string | null;
  referenceId: string;
  createdAt: string;
  updatedAt: string;
};

export type LiveClientOnboarding = {
  clientId: string;
  projectId: string;
  status: string;
  monthlyBudget: number;
  targetMarket: string;
  marketScope: "service_area" | "nationwide";
  services: string[];
  serviceAreas: string[];
  phone: string | null;
  automationLevel: "recommend" | "safe" | "autopilot";
  detectedPlatform: string;
  platformLabel: string;
  platformConfidence: string;
  websiteReachable: boolean;
  launchedAt: string | null;
};

export type LiveClientGrowthProfile = {
  clientId: string;
  projectId: string;
  onboardingStatus: string;
  onboardingStep: number;
  businessGoal: string;
  services: string[];
  serviceAreas: string[];
  marketScope: "service_area" | "nationwide";
  priorityServices: string[];
  idealCustomer: string | null;
  averageCustomerValue: number | null;
  monthlyBudget: number;
  automationLevel: "recommend" | "safe" | "concierge";
  notificationPreferences: Record<string, boolean>;
};

export type LiveClientSubscription = {
  projectId: string;
  planKey: "free_audit" | "starter" | "growth" | "pro" | "autopilot_plus";
  status: string;
  billingInterval: string;
  priceCents: number;
  offerKey: string | null;
  offerPriceCents: number | null;
  offerEndsAt: string | null;
  betaRedeemedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type LiveClientTrialEntitlement = {
  projectId: string;
  benefitKey: "website_crawl";
  allowance: number;
  usedCount: number;
  remaining: number;
  status: "active" | "exhausted" | "expired" | "converted";
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageStatus: "claimed" | "queued" | "succeeded" | "failed" | null;
};

export type LiveClientWebsite = {
  id: string;
  projectId: string;
  siteUrl: string;
  cmsType: string;
  status: string;
  lastVerifiedAt: string | null;
};

export type LiveClientIntegration = {
  projectId: string;
  provider: string;
  status: string;
  lastSyncedAt: string | null;
};

export type LiveClientAgentWork = {
  id: string;
  projectId: string;
  agentKey: string;
  goal: string;
  status: string;
  spentAmount: number;
  updatedAt: string;
};

export type LiveClientOutcome = {
  projectId: string;
  clicks: number;
  impressions: number;
  leads: number;
  qualifiedLeads: number;
  recordedRevenue: number;
  recordedGrossProfit: number;
};

export type LiveClientSupportRequest = {
  id: string;
  projectId: string;
  category: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
};

export type AgencyMembership = { agency: LiveAgency; role: AgencyRole };
export type LiveClientAccess = { client: LiveClient; role: string };

// ---------------------------------------------------------------------------
// Client-visible package statuses (portal vocabulary)
// ---------------------------------------------------------------------------

export const CLIENT_VISIBLE_PACKAGE_STATUSES = [
  "client_review",
  "awaiting_client",
  "client_approved",
  "revision_requested",
  "rejected",
  "implemented",
  "implemented_unverified",
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
  const { data } = await db.from("profiles").select("id,email").in("id", ids);
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
const rowNullableText = (row: DatabaseRow, key: string) =>
  typeof row[key] === "string" ? (row[key] as string) : null;
const rowNumber = (row: DatabaseRow, key: string, fallback = 0) => {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : fallback;
};

function mapAgency(row: DatabaseRow): LiveAgency {
  return {
    id: rowText(row, "id"),
    name: rowText(row, "name"),
    slug: rowText(row, "slug"),
    ownerEmail: rowText(row, "billing_email"),
    repositoryExecutionEnabled: row.repository_execution_enabled === true,
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
    marketScope:
      rowText(row, "market_scope") === "nationwide"
        ? "nationwide"
        : "service_area",
    createdAt: toIso(row.created_at),
  };
}

function mapOpportunity(row: DatabaseRow): LiveOpportunity {
  const evidence = asRecord(row.evidence);
  const businessValue = asRecord(evidence.businessValue);
  const reasonFromCodes = Array.isArray(row.reason_codes)
    ? row.reason_codes.join(", ")
    : "";
  return {
    id: rowText(row, "id"),
    agencyId: rowText(row, "agency_id"),
    projectId: rowText(row, "project_id"),
    keyword: (evidence.keyword as string) ?? rowText(row, "opportunity_key"),
    currentRank:
      typeof (evidence.currentRank ?? evidence.current_rank) === "number"
        ? ((evidence.currentRank ?? evidence.current_rank) as number)
        : null,
    targetRank:
      typeof evidence.target_rank === "number"
        ? (evidence.target_rank as number)
        : 10,
    score:
      typeof row.opportunity_score === "number" ? row.opportunity_score : 0,
    actionType: rowText(row, "action_type"),
    reason:
      (typeof evidence.valueExplanation === "string"
        ? evidence.valueExplanation
        : (evidence.reason as string)) ?? reasonFromCodes,
    status: rowText(row, "status"),
    searchVolume:
      typeof (evidence.searchVolume ?? evidence.search_volume) === "number"
        ? (evidence.searchVolume ?? evidence.search_volume) as number
        : null,
    cpc: typeof evidence.cpc === "number" ? evidence.cpc : null,
    difficulty:
      typeof evidence.keyword_difficulty === "number"
        ? evidence.keyword_difficulty
        : null,
    estimatedMonthlyValue:
      typeof (businessValue.expectedMonthlyProfit ?? evidence.estimated_monthly_value) === "number"
        ? (businessValue.expectedMonthlyProfit ?? evidence.estimated_monthly_value) as number
        : null,
    estimatedEffort:
      typeof (businessValue.implementationCost ?? evidence.estimated_effort) === "number"
        ? (businessValue.implementationCost ?? evidence.estimated_effort) as number
        : null,
    valuePerDollar:
      typeof evidence.value_per_dollar === "number"
        ? evidence.value_per_dollar
        : typeof businessValue.expectedMonthlyProfit === "number" && typeof businessValue.implementationCost === "number" && businessValue.implementationCost > 0
          ? businessValue.expectedMonthlyProfit / businessValue.implementationCost
        : null,
    source: (evidence.source as string) ?? "autonomous_evidence",
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

function mapPackage(row: DatabaseRow, publication?: DatabaseRow): LivePackage {
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
    publicationId: publication ? rowText(publication, "id") : null,
    publicationStatus: publication ? rowText(publication, "status") : null,
    publicationProvider: publication ? rowText(publication, "provider") : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapEvent(row: DatabaseRow, emails: Map<string, string>): LiveEvent {
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
      (row.actor_user_id ? (emails.get(String(row.actor_user_id)) ?? "") : ""),
    clientVisible: Boolean(row.client_visible),
    createdAt: toIso(row.occurred_at),
  };
}

function mapCampaignJob(row: DatabaseRow): LiveCampaignJob {
  return {
    id: rowText(row, "id"),
    projectId: rowText(row, "project_id"),
    status: rowText(row, "status"),
    currentStage: rowText(row, "current_stage"),
    progressPercent:
      typeof row.progress_percent === "number" ? row.progress_percent : 0,
    errorMessage: rowText(row, "error_message") || null,
    referenceId: rowText(row, "reference_id"),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
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
    throw new ApiError(
      "Sign in before creating an agency.",
      403,
      "TENANT_DENIED",
    );
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

  await recordAudit(db, {
    agencyId: agency.id,
    actorUserId: userId,
    action: "agency.created",
    resourceType: "agency",
    resourceId: agency.id,
    afterState: { name },
  });

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
    .select("role,agencies(id,name,slug,billing_email,repository_execution_enabled,created_at)")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!data?.agencies) return null;
  const agencyRow = Array.isArray(data.agencies)
    ? data.agencies[0]
    : data.agencies;
  if (!agencyRow) return null;

  return { agency: mapAgency(agencyRow), role: data.role as AgencyRole };
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
      websites: [] as LiveWebsite[],
      opportunities: [] as LiveOpportunity[],
      tasks: [] as LiveTask[],
      packages: [] as LivePackage[],
      events: [] as LiveEvent[],
      jobs: [] as LiveCampaignJob[],
      onboardings: [] as LiveClientOnboarding[],
      implementationReadiness: [] as LiveImplementationReadiness[],
      permissions: [] as string[],
    };
  }

  const db = admin();
  const agencyId = membership.agency.id;

  const [
    clientsRes,
    enterpriseClientsRes,
    projectsRes,
    opportunitiesRes,
    tasksRes,
    packagesRes,
    eventsRes,
    jobsRes,
    websitesRes,
    connectionsRes,
    googleRes,
    publicationsRes,
    repositoryConnectionsRes,
    vercelProjectsRes,
  ] = await Promise.all([
    db
      .from("client_organizations")
      .select("*")
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false }),
    db
      .from("clients")
      .select("organization_id,automation_config")
      .eq("agency_id", agencyId),
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
    db
      .from("seo_campaign_jobs")
      .select(
        "id,project_id,status,current_stage,progress_percent,error_message,reference_id,created_at,updated_at",
      )
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("websites")
      .select(
        "id,project_id,name,site_url,canonical_domain,cms_type,status,last_verified_at,created_at",
      )
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false }),
    db
      .from("cms_connections")
      .select(
        "id,project_id,website_id,cms_type,editor_mode,connection_mode,status,last_verified_at,updated_at",
      )
      .eq("agency_id", agencyId)
      .order("updated_at", { ascending: false }),
    db
      .from("integration_connections")
      .select(
        "id,project_id,status,selected_resource,last_synced_at,last_verified_at,metadata,updated_at",
      )
      .eq("agency_id", agencyId)
      .eq("provider", "google_search_console")
      .order("updated_at", { ascending: false }),
    db
      .from("cms_publications")
      .select("id,package_id,provider,status,created_at")
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false }),
    db
      .from("repository_connections")
      .select("project_id,status,installation_id")
      .eq("agency_id", agencyId),
    db
      .from("vercel_projects")
      .select("project_id,status")
      .eq("agency_id", agencyId),
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
  const connectionByWebsite = new Map<string, DatabaseRow>();
  const connectionByProject = new Map<string, DatabaseRow>();
  for (const row of connectionsRes.data ?? []) {
    if (!connectionByWebsite.has(rowText(row, "website_id"))) {
      connectionByWebsite.set(rowText(row, "website_id"), row);
    }
    if (!connectionByProject.has(rowText(row, "project_id"))) {
      connectionByProject.set(rowText(row, "project_id"), row);
    }
  }
  const repositoryProjects = new Set(
    (repositoryConnectionsRes.data ?? [])
      .filter((row) => row.status === "connected" && row.installation_id != null)
      .map((row) => String(row.project_id)),
  );
  const vercelProjects = new Set(
    (vercelProjectsRes.data ?? [])
      .filter((row) => row.status === "active")
      .map((row) => String(row.project_id)),
  );
  const googleByProject = new Map<string, DatabaseRow>();
  for (const row of googleRes.data ?? [])
    if (!googleByProject.has(rowText(row, "project_id")))
      googleByProject.set(rowText(row, "project_id"), row);
  const publicationByPackage = new Map<string, DatabaseRow>();
  for (const row of publicationsRes.data ?? [])
    if (!publicationByPackage.has(rowText(row, "package_id")))
      publicationByPackage.set(rowText(row, "package_id"), row);
  const projectByClient = new Map<string, DatabaseRow>();
  for (const row of projectsRes.data ?? [])
    if (!projectByClient.has(rowText(row, "client_organization_id")))
      projectByClient.set(rowText(row, "client_organization_id"), row);
  const onboardings = (enterpriseClientsRes.data ?? []).flatMap((row) => {
    const config = asRecord(row.automation_config);
    if (Number(config.onboardingVersion ?? 0) < 1) return [];
    const project = projectByClient.get(rowText(row, "organization_id"));
    if (!project) return [];
    const automationLevel = ["recommend", "safe", "autopilot"].includes(
      String(config.automationLevel),
    )
      ? (String(
          config.automationLevel,
        ) as LiveClientOnboarding["automationLevel"])
      : "safe";
    return [
      {
        clientId: rowText(row, "organization_id"),
        projectId: rowText(project, "id"),
        status:
          typeof config.onboardingStatus === "string"
            ? config.onboardingStatus
            : "business_saved",
        monthlyBudget:
          typeof config.monthlyBudget === "number"
            ? config.monthlyBudget
            : 1500,
        targetMarket:
          typeof config.targetMarket === "string"
            ? config.targetMarket
            : "United States",
        marketScope:
          rowText(project, "market_scope") === "nationwide" ||
          config.marketScope === "nationwide"
            ? "nationwide"
            : "service_area",
        services: Array.isArray(config.services)
          ? config.services.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        serviceAreas: Array.isArray(config.serviceAreas)
          ? config.serviceAreas.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        phone: typeof config.phone === "string" ? config.phone : null,
        automationLevel,
        detectedPlatform:
          typeof config.detectedPlatform === "string"
            ? config.detectedPlatform
            : "custom",
        platformLabel:
          typeof config.platformLabel === "string"
            ? config.platformLabel
            : "Website",
        platformConfidence:
          typeof config.platformConfidence === "string"
            ? config.platformConfidence
            : "low",
        websiteReachable: config.websiteReachable === true,
        launchedAt:
          typeof config.launchedAt === "string" ? config.launchedAt : null,
      } satisfies LiveClientOnboarding,
    ];
  });

  const implementationReadiness = (projectsRes.data ?? []).map((project) => {
    const projectId = rowText(project, "id");
    const connection = connectionByProject.get(projectId);
    const cmsType = connection ? rowText(connection, "cms_type") : "";
    const cmsProvider = ["wordpress", "shopify", "webflow"].includes(cmsType)
      ? (cmsType as LiveImplementationReadiness["cmsProvider"])
      : null;
    const repositoryConnected = repositoryProjects.has(projectId);
    const repositoryBlockers = [
      !membership.agency.repositoryExecutionEnabled
        ? "AGENCY_FEATURE_DISABLED"
        : null,
      project.repository_execution_enabled !== true
        ? "PROJECT_FEATURE_DISABLED"
        : null,
      project.manual_workflow_verified_at == null
        ? "MANUAL_WORKFLOW_NOT_VERIFIED"
        : null,
      !repositoryConnected ? "REPOSITORY_NOT_VERIFIED" : null,
    ].filter((item): item is string => Boolean(item));
    return {
      projectId,
      cmsProvider,
      cmsReady:
        cmsProvider !== null &&
        connection?.status === "active" &&
        connection.last_verified_at != null,
      repositoryConnected,
      repositoryReady: repositoryBlockers.length === 0,
      repositoryBlockers,
      vercelConnected: vercelProjects.has(projectId),
    } satisfies LiveImplementationReadiness;
  });

  return {
    agency: membership.agency,
    role: membership.role,
    clients: clients.map((row) => mapClient(row, domainByOrg)),
    projects: (projectsRes.data ?? []).map(mapProject),
    websites: (websitesRes.data ?? []).map((row) => {
      const connection = connectionByWebsite.get(rowText(row, "id"));
      const google = googleByProject.get(rowText(row, "project_id"));
      const metadata = asRecord(google?.metadata);
      return {
        id: rowText(row, "id"),
        projectId: rowText(row, "project_id"),
        name: rowText(row, "name"),
        siteUrl: rowText(row, "site_url"),
        canonicalDomain: rowText(row, "canonical_domain"),
        cmsType: rowText(row, "cms_type", "unknown"),
        status: rowText(row, "status", "connection_required"),
        lastVerifiedAt: rowNullableText(row, "last_verified_at"),
        connectionId: connection ? rowText(connection, "id") : null,
        connectionMode: connection
          ? rowNullableText(connection, "connection_mode")
          : null,
        connectionStatus: connection
          ? rowNullableText(connection, "status")
          : null,
        editorMode: connection
          ? rowNullableText(connection, "editor_mode")
          : null,
        googleSearchConsole: google
          ? {
              id: rowText(google, "id"),
              status: rowText(google, "status"),
              selectedProperty: rowNullableText(google, "selected_resource"),
              lastSyncedAt: rowNullableText(google, "last_synced_at"),
              lastVerifiedAt: rowNullableText(google, "last_verified_at"),
              properties: Array.isArray(metadata.properties)
                ? metadata.properties.flatMap((item) => {
                    const property = asRecord(item);
                    return typeof property.siteUrl === "string"
                      ? [
                          {
                            siteUrl: property.siteUrl,
                            permissionLevel:
                              typeof property.permissionLevel === "string"
                                ? property.permissionLevel
                                : undefined,
                          },
                        ]
                      : [];
                  })
                : [],
              health: rowText(metadata, "health", "unknown"),
            }
          : null,
      } satisfies LiveWebsite;
    }),
    opportunities: (opportunitiesRes.data ?? []).map(mapOpportunity),
    tasks: (tasksRes.data ?? []).map(mapTask),
    packages: (packagesRes.data ?? []).map((row) =>
      mapPackage(row, publicationByPackage.get(rowText(row, "id"))),
    ),
    events: (eventsRes.data ?? []).map((row) => mapEvent(row, emails)),
    jobs: (jobsRes.data ?? []).map(mapCampaignJob),
    onboardings,
    implementationReadiness,
    permissions: [...permissionMatrix[membership.role]],
  };
}

export async function liveClientSnapshot(email: string) {
  const db = admin();
  const userId = await resolveUserId(db, email);
  const empty = {
    clients: [] as LiveClientAccess[],
    projects: [] as LiveProject[],
    opportunities: [] as LiveOpportunity[],
    packages: [] as LivePackage[],
    events: [] as LiveEvent[],
    growthProfiles: [] as LiveClientGrowthProfile[],
    subscriptions: [] as LiveClientSubscription[],
    trialEntitlements: [] as LiveClientTrialEntitlement[],
    websites: [] as LiveClientWebsite[],
    integrations: [] as LiveClientIntegration[],
    agentWork: [] as LiveClientAgentWork[],
    outcomes: [] as LiveClientOutcome[],
    supportRequests: [] as LiveClientSupportRequest[],
  };
  if (!userId) {
    return empty;
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
    return empty;
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
      ...empty,
      clients,
      projects: projects.map(mapProject),
    };
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [
    publicationsRes,
    eventsRes,
    profilesRes,
    subscriptionsRes,
    trialEntitlementsRes,
    trialUsageRes,
    websitesRes,
    integrationsRes,
    agentWorkRes,
    searchRowsRes,
    leadsRes,
    supportRes,
  ] = await Promise.all([
    db
      .from("client_portal_publications")
      .select("source_id")
      .in("project_id", projectIds)
      .eq("record_type", "implementation_package")
      .is("revoked_at", null),
    db
      .from("proof_of_work_events")
      .select("*")
      .in("project_id", projectIds)
      .eq("client_visible", true)
      .order("occurred_at", { ascending: false })
      .limit(100),
    db.from("client_growth_profiles").select("*").in("project_id", projectIds),
    db.from("client_subscriptions").select("*").in("project_id", projectIds),
    db.from("client_trial_entitlements").select("*").in("project_id",projectIds),
    db.from("client_trial_usage").select("project_id,status,claimed_at").in("project_id",projectIds).order("claimed_at",{ascending:false}),
    db
      .from("websites")
      .select("id,project_id,site_url,cms_type,status,last_verified_at")
      .in("project_id", projectIds)
      .eq("is_primary", true),
    db
      .from("integration_connections")
      .select("project_id,provider,status,last_synced_at")
      .in("project_id", projectIds),
    db
      .from("agent_work_items")
      .select(
        "id,project_id,assigned_agent_key,goal,status,spent_amount,updated_at",
      )
      .in("project_id", projectIds)
      .in("status", [
        "queued",
        "planning",
        "awaiting_approval",
        "waiting_for_tools",
        "running",
        "validating",
        "blocked",
      ])
      .order("updated_at", { ascending: false })
      .limit(100),
    db
      .from("search_console_rows")
      .select("project_id,clicks,impressions")
      .in("project_id", projectIds)
      .gte("date", ninetyDaysAgo)
      .limit(5000),
    db
      .from("seo_leads")
      .select("project_id,qualified,revenue,gross_profit")
      .in("project_id", projectIds)
      .gte("occurred_at", `${ninetyDaysAgo}T00:00:00Z`)
      .limit(2000),
    db
      .from("client_support_requests")
      .select("id,project_id,category,subject,message,status,created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const publishedPackageIds = (publicationsRes.data ?? [])
    .map((row) => row.source_id as string | null)
    .filter(Boolean) as string[];
  const packagesRes = publishedPackageIds.length
    ? await db
        .from("implementation_packages")
        .select("*")
        .in("id", publishedPackageIds)
        .in("status", [...CLIENT_VISIBLE_PACKAGE_STATUSES])
        .order("updated_at", { ascending: false })
    : { data: [] };
  const opportunityIds = (packagesRes.data ?? [])
    .map((row) => row.opportunity_id as string | null)
    .filter(Boolean) as string[];
  const publishedOpportunitiesRes = opportunityIds.length
    ? await db
        .from("seo_opportunities")
        .select("*")
        .in("id", opportunityIds)
        .order("opportunity_score", { ascending: false })
    : { data: [] };
  const retailProjectIds = (profilesRes.data ?? [])
    .map((row) => row.project_id as string)
    .filter(Boolean);
  const retailOpportunitiesRes = retailProjectIds.length
    ? await db
        .from("seo_opportunities")
        .select("*")
        .in("project_id", retailProjectIds)
        .in("status", ["open", "selected", "approved", "monitoring"])
        .order("opportunity_score", { ascending: false })
        .limit(100)
    : { data: [] };
  const opportunityRows = [
    ...new Map(
      [
        ...(publishedOpportunitiesRes.data ?? []),
        ...(retailOpportunitiesRes.data ?? []),
      ].map((row) => [row.id as string, row]),
    ).values(),
  ];

  const emails = await emailMap(
    db,
    (eventsRes.data ?? []).map((row) => row.actor_user_id),
  );

  const outcomeMap = new Map<string, LiveClientOutcome>();
  const latestTrialUsage=new Map<string,string>();
  for(const raw of trialUsageRes.data??[]){const row=raw as DatabaseRow,projectId=rowText(row,"project_id");if(projectId&&!latestTrialUsage.has(projectId))latestTrialUsage.set(projectId,rowText(row,"status"));}
  for (const projectId of projectIds) {
    outcomeMap.set(projectId, {
      projectId,
      clicks: 0,
      impressions: 0,
      leads: 0,
      qualifiedLeads: 0,
      recordedRevenue: 0,
      recordedGrossProfit: 0,
    });
  }
  for (const raw of searchRowsRes.data ?? []) {
    const row = raw as DatabaseRow;
    const outcome = outcomeMap.get(rowText(row, "project_id"));
    if (!outcome) continue;
    outcome.clicks += rowNumber(row, "clicks");
    outcome.impressions += rowNumber(row, "impressions");
  }
  for (const raw of leadsRes.data ?? []) {
    const row = raw as DatabaseRow;
    const outcome = outcomeMap.get(rowText(row, "project_id"));
    if (!outcome) continue;
    outcome.leads += 1;
    if (row.qualified === true) outcome.qualifiedLeads += 1;
    outcome.recordedRevenue += rowNumber(row, "revenue");
    outcome.recordedGrossProfit += rowNumber(row, "gross_profit");
  }

  return {
    clients,
    projects: projects.map(mapProject),
    opportunities: opportunityRows.map(mapOpportunity),
    packages: (packagesRes.data ?? []).map((row) => mapPackage(row)),
    events: (eventsRes.data ?? []).map((row) => mapEvent(row, emails)),
    growthProfiles: (profilesRes.data ?? []).map((raw) => {
      const row = raw as DatabaseRow;
      return {
        clientId: rowText(row, "client_organization_id"),
        projectId: rowText(row, "project_id"),
        onboardingStatus: rowText(row, "onboarding_status", "business_profile"),
        onboardingStep: rowNumber(row, "onboarding_step", 1),
        businessGoal: rowText(row, "business_goal", "more_qualified_leads"),
        services: Array.isArray(row.services) ? (row.services as string[]) : [],
        serviceAreas: Array.isArray(row.service_areas)
          ? (row.service_areas as string[])
          : [],
        marketScope: (
          rowText(
            projects.find(
              (item) => rowText(item, "id") === rowText(row, "project_id"),
            ) ?? {},
            "market_scope",
          ) === "nationwide"
            ? "nationwide"
            : "service_area"
        ) as LiveClientGrowthProfile["marketScope"],
        priorityServices: Array.isArray(row.priority_services)
          ? (row.priority_services as string[])
          : [],
        idealCustomer: rowNullableText(row, "ideal_customer"),
        averageCustomerValue:
          row.average_customer_value == null
            ? null
            : rowNumber(row, "average_customer_value"),
        monthlyBudget: rowNumber(row, "monthly_budget", 99),
        automationLevel: ["recommend", "safe", "concierge"].includes(
          rowText(row, "automation_level"),
        )
          ? (rowText(row, "automation_level") as
              | "recommend"
              | "safe"
              | "concierge")
          : "safe",
        notificationPreferences: Object.fromEntries(
          Object.entries(asRecord(row.notification_preferences)).map(
            ([key, value]) => [key, value === true],
          ),
        ),
      };
    }),
    subscriptions: (subscriptionsRes.data ?? []).map((raw) => {
      const row = raw as DatabaseRow;
      return {
        projectId: rowText(row, "project_id"),
        planKey: rowText(
          row,
          "plan_key",
          "free_audit",
        ) as LiveClientSubscription["planKey"],
        status: rowText(row, "status", "trialing"),
        billingInterval: rowText(row, "billing_interval", "month"),
        priceCents: rowNumber(row, "price_cents"),
        offerKey: rowNullableText(row,"offer_key"),
        offerPriceCents: row.offer_price_cents===null||row.offer_price_cents===undefined?null:rowNumber(row,"offer_price_cents"),
        offerEndsAt: rowNullableText(row,"offer_ends_at"),
        betaRedeemedAt: rowNullableText(row,"beta_redeemed_at"),
        trialEndsAt: rowNullableText(row, "trial_ends_at"),
        currentPeriodEnd: rowNullableText(row, "current_period_end"),
        cancelAtPeriodEnd: row.cancel_at_period_end === true,
      };
    }),
    trialEntitlements: (trialEntitlementsRes.data ?? []).map((raw) => {
      const row=raw as DatabaseRow,allowance=rowNumber(row,"allowance",1),usedCount=rowNumber(row,"used_count"),expiresAt=rowNullableText(row,"expires_at");
      const usageStatus=latestTrialUsage.get(rowText(row,"project_id"));
      const status=expiresAt&&new Date(expiresAt).getTime()<=Date.now()?"expired":rowText(row,"status","active");
      return {
        projectId:rowText(row,"project_id"),
        benefitKey:"website_crawl" as const,
        allowance,
        usedCount,
        remaining:Math.max(0,allowance-usedCount),
        status:status as LiveClientTrialEntitlement["status"],
        expiresAt,
        lastUsedAt:rowNullableText(row,"last_used_at"),
        usageStatus:["claimed","queued","succeeded","failed"].includes(usageStatus??"")?usageStatus as LiveClientTrialEntitlement["usageStatus"]:null,
      };
    }),
    websites: (websitesRes.data ?? []).map((raw) => {
      const row = raw as DatabaseRow;
      return {
        id: rowText(row, "id"),
        projectId: rowText(row, "project_id"),
        siteUrl: rowText(row, "site_url"),
        cmsType: rowText(row, "cms_type", "unknown"),
        status: rowText(row, "status"),
        lastVerifiedAt: rowNullableText(row, "last_verified_at"),
      };
    }),
    integrations: (integrationsRes.data ?? []).map((raw) => {
      const row = raw as DatabaseRow;
      return {
        projectId: rowText(row, "project_id"),
        provider: rowText(row, "provider"),
        status: rowText(row, "status"),
        lastSyncedAt: rowNullableText(row, "last_synced_at"),
      };
    }),
    agentWork: (agentWorkRes.data ?? []).map((raw) => {
      const row = raw as DatabaseRow;
      return {
        id: rowText(row, "id"),
        projectId: rowText(row, "project_id"),
        agentKey: rowText(row, "assigned_agent_key"),
        goal: rowText(row, "goal"),
        status: rowText(row, "status"),
        spentAmount: rowNumber(row, "spent_amount"),
        updatedAt: toIso(row.updated_at),
      };
    }),
    outcomes: [...outcomeMap.values()],
    supportRequests: (supportRes.data ?? []).map((raw) => {
      const row = raw as DatabaseRow;
      return {
        id: rowText(row, "id"),
        projectId: rowText(row, "project_id"),
        category: rowText(row, "category"),
        subject: rowText(row, "subject"),
        message: rowText(row, "message"),
        status: rowText(row, "status"),
        createdAt: toIso(row.created_at),
      };
    }),
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
  role: AgencyRole;
}> {
  const db = admin();
  const membership = await requireAgency(email);
  const userId = await resolveUserId(db, email);
  if (!userId) {
    throw new ApiError("Sign in before continuing.", 403, "TENANT_DENIED");
  }
  return { db, agencyId: membership.agency.id, userId, role: membership.role };
}

function requireLivePermission(
  role: AgencyRole,
  ...permissions: string[]
): void {
  if (!permissions.some((permission) => hasPermission(role, permission))) {
    throw new ApiError(
      "Your agency role cannot perform this action.",
      403,
      "ROLE_FORBIDDEN",
    );
  }
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

async function recordAudit(
  db: SupabaseClient,
  input: {
    agencyId: string;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    afterState?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from("audit_events").insert({
    agency_id: input.agencyId,
    actor_user_id: input.actorUserId,
    actor_type: "user",
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    after_state: input.afterState ?? null,
    metadata: { source: "live_portal" },
  });
  if (error) {
    throw new ApiError(
      "The action completed, but its audit record could not be stored.",
      500,
      "OPERATION_FAILED",
    );
  }
}

export async function createClientWithProject(
  email: string,
  input: { name: string; domain: string; contactEmail?: string },
): Promise<{ clientId: string; projectId: string; websiteId: string }> {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "clients.manage");
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

  const { data: website, error: websiteError } = await db
    .from("websites")
    .insert({
      agency_id: agencyId,
      client_organization_id: org.id,
      project_id: project.id,
      name: input.name,
      site_url: `https://${cleanDomain}`,
      canonical_domain: cleanDomain,
      cms_type: "unknown",
      is_primary: true,
      status: "connection_required",
    })
    .select("id")
    .single();
  if (websiteError || !website) {
    throw new ApiError(
      `The client was created, but its website onboarding record could not be saved: ${websiteError.message}`,
      500,
      "DATABASE_BINDING_FAILED",
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
          role: "client_admin",
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
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: "client.created",
    resourceType: "client_organization",
    resourceId: org.id,
    afterState: { projectId: project.id, domain: cleanDomain },
  });
  return {
    clientId: org.id as string,
    projectId: project.id as string,
    websiteId: website.id as string,
  };
}

export type ClientOnboardingInput = {
  name: string;
  domain: string;
  contactEmail?: string;
  phone?: string;
  services: string[];
  serviceAreas: string[];
  marketScope: "service_area" | "nationwide";
  monthlyBudget: number;
  targetMarket: string;
};

export type RetailBusinessInput = {
  businessName: string;
  domain: string;
  phone?: string;
  services: string[];
  serviceAreas: string[];
  marketScope: "service_area" | "nationwide";
  priorityServices: string[];
  idealCustomer?: string;
  averageCustomerValue?: number;
  monthlyBudget: number;
  automationLevel: "recommend" | "safe" | "concierge";
};

async function clientProjectContext(email: string, projectId: string) {
  const db = admin();
  const userId = await resolveUserId(db, email);
  if (!userId)
    throw new ApiError("Client access denied.", 403, "TENANT_DENIED");
  const project = await db
    .from("seo_projects")
    .select("id,agency_id,client_organization_id,primary_market")
    .eq("id", projectId)
    .maybeSingle();
  if (!project.data)
    throw new ApiError("Business project not found.", 404, "NOT_FOUND");
  const member = await db
    .from("client_members")
    .select("role")
    .eq("user_id", userId)
    .eq("client_organization_id", project.data.client_organization_id)
    .eq("status", "active")
    .maybeSingle();
  if (!member.data)
    throw new ApiError("Client access denied.", 403, "TENANT_DENIED");
  return {
    db,
    userId,
    role: member.data.role as string,
    agencyId: project.data.agency_id as string,
    clientId: project.data.client_organization_id as string,
    projectId: project.data.id as string,
    primaryMarket: (project.data.primary_market as string | null) ?? null,
  };
}

export async function createRetailBusiness(
  email: string,
  input: RetailBusinessInput,
) {
  const db = admin();
  const userId = await resolveUserId(db, email);
  if (!userId)
    throw new ApiError(
      "Sign in before adding your business.",
      403,
      "TENANT_DENIED",
    );
  const membership = await db
    .from("client_members")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (membership.data)
    throw new ApiError(
      "This account already has a business workspace.",
      409,
      "CONFLICT",
    );

  const analysis = await detectWebsitePlatform(input.domain);
  const services = [
    ...new Set(input.services.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 20);
  const serviceAreas = [
    ...new Set(input.serviceAreas.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 30);
  if (input.marketScope === "service_area" && !serviceAreas.length) {
    throw new ApiError(
      "Add at least one city or service area, or choose Nationwide.",
      422,
      "SERVICE_AREA_REQUIRED",
    );
  }
  const priorityServices = [
    ...new Set(
      input.priorityServices.map((value) => value.trim()).filter(Boolean),
    ),
  ]
    .filter((value) => services.includes(value))
    .slice(0, 5);
  const result = await db.rpc("create_retail_workspace", {
    p_user_id: userId,
    p_email: email.toLowerCase(),
    p_business_name: input.businessName.trim(),
    p_domain: analysis.canonicalDomain,
    p_site_url: analysis.siteUrl,
    p_phone: input.phone?.trim() || null,
    p_services: services,
    p_service_areas: serviceAreas,
    p_priority_services: priorityServices,
    p_ideal_customer: input.idealCustomer?.trim() || null,
    p_customer_value: input.averageCustomerValue ?? null,
    p_monthly_budget: input.monthlyBudget,
    p_automation_level: input.automationLevel,
    p_platform: analysis.platform,
    p_website_reachable: analysis.reachable,
  });
  const created = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !created) {
    throw new ApiError(
      result.error?.message?.includes("create_retail_workspace")
        ? "Retail onboarding is not ready. Apply migration 0022 and try again."
        : "Your business workspace could not be created.",
      500,
      "DATABASE_BINDING_FAILED",
    );
  }
  const marketWrite = await db
    .from("seo_projects")
    .update({
      market_scope: input.marketScope,
      primary_market:
        input.marketScope === "nationwide" ? "United States" : serviceAreas[0],
      updated_at: nowIso(),
    })
    .eq("id", created.project_id);
  if (marketWrite.error) {
    throw new ApiError(
      "The business market scope could not be saved. Apply migration 0023 and retry.",
      500,
      "DATABASE_BINDING_FAILED",
    );
  }
  if (analysis.reachable) {
    await db.from("cms_connections").upsert(
      {
        agency_id: created.agency_id,
        client_organization_id: created.client_id,
        project_id: created.project_id,
        website_id: created.website_id,
        cms_type: analysis.platform,
        editor_mode: "read_only",
        site_url: analysis.siteUrl,
        connection_mode: "monitor_only",
        status: "active",
        last_verified_at: nowIso(),
        updated_at: nowIso(),
      },
      { onConflict: "project_id,site_url" },
    );
  }
  await recordAudit(db, {
    agencyId: created.agency_id,
    actorUserId: userId,
    action: "retail.business.created",
    resourceType: "seo_project",
    resourceId: created.project_id,
    afterState: {
      platform: analysis.platform,
      websiteReachable: analysis.reachable,
      serviceCount: services.length,
      serviceAreaCount: serviceAreas.length,
      marketScope: input.marketScope,
      automationLevel: input.automationLevel,
    },
  });
  return { ...created, analysis };
}

export async function updateRetailGrowthProfile(
  email: string,
  input: {
    projectId: string;
    businessGoal: string;
    services: string[];
    serviceAreas: string[];
    marketScope: "service_area" | "nationwide";
    priorityServices: string[];
    idealCustomer?: string;
    averageCustomerValue?: number;
    monthlyBudget: number;
    automationLevel: "recommend" | "safe" | "concierge";
    notificationPreferences: Record<string, boolean>;
  },
) {
  const context = await clientProjectContext(email, input.projectId);
  if (context.role !== "client_admin")
    throw new ApiError(
      "Only the business owner can change growth controls.",
      403,
      "ROLE_FORBIDDEN",
    );
  const services = [
    ...new Set(input.services.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 20);
  const areas = [
    ...new Set(input.serviceAreas.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 30);
  if (input.marketScope === "service_area" && !areas.length) {
    throw new ApiError(
      "Add at least one city or service area, or choose Nationwide.",
      422,
      "SERVICE_AREA_REQUIRED",
    );
  }
  const update = await context.db.from("client_growth_profiles").upsert(
    {
      agency_id: context.agencyId,
      client_organization_id: context.clientId,
      project_id: input.projectId,
      owner_user_id: context.userId,
      onboarding_status: "ready",
      onboarding_step: 6,
      business_goal: input.businessGoal,
      services,
      service_areas: areas,
      priority_services: input.priorityServices
        .filter((value) => services.includes(value))
        .slice(0, 5),
      ideal_customer: input.idealCustomer?.trim() || null,
      average_customer_value: input.averageCustomerValue ?? null,
      monthly_budget: input.monthlyBudget,
      automation_level: input.automationLevel,
      notification_preferences: input.notificationPreferences,
      updated_at: nowIso(),
    },
    { onConflict: "project_id" },
  );
  if (update.error)
    throw new ApiError(
      "Your growth settings could not be saved. Apply migration 0022 and retry.",
      500,
      "DATABASE_BINDING_FAILED",
    );
  await Promise.all([
    context.db
      .from("clients")
      .update({
        automation_config: {
          automationLevel: input.automationLevel,
          monthlyBudget: input.monthlyBudget,
          approvalRequired: input.automationLevel !== "safe",
          safeChangesAutomatic: input.automationLevel === "safe",
          highRiskApprovalRequired: true,
          autoRollback: true,
        },
        updated_at: nowIso(),
      })
      .eq("organization_id", context.clientId),
    context.db
      .from("seo_projects")
      .update({
        market_scope: input.marketScope,
        primary_market:
          input.marketScope === "nationwide"
            ? "United States"
            : (areas[0] ?? context.primaryMarket),
        industry: services[0] ?? null,
        updated_at: nowIso(),
      })
      .eq("id", input.projectId),
  ]);
  await context.db
    .from("seo_services")
    .delete()
    .eq("project_id", input.projectId);
  if (services.length)
    await context.db.from("seo_services").insert(
      services.map((name, index) => ({
        agency_id: context.agencyId,
        client_organization_id: context.clientId,
        project_id: input.projectId,
        name,
        slug: `${onboardingSlug(name)}-${index + 1}`,
        category: "core_service",
        priority: Math.max(50, 100 - index * 5),
        status: "active",
      })),
    );
  await context.db
    .from("seo_locations")
    .delete()
    .eq("project_id", input.projectId);
  if (areas.length)
    await context.db.from("seo_locations").insert(
      areas.map((name, index) => ({
        agency_id: context.agencyId,
        client_organization_id: context.clientId,
        project_id: input.projectId,
        name,
        city: name,
        country_code: "US",
        priority: Math.max(50, 100 - index * 3),
        status: "active",
      })),
    );
  await recordAudit(context.db, {
    agencyId: context.agencyId,
    actorUserId: context.userId,
    action: "retail.growth_profile.updated",
    resourceType: "seo_project",
    resourceId: input.projectId,
    afterState: {
      businessGoal: input.businessGoal,
      automationLevel: input.automationLevel,
      services,
      serviceAreas: areas,
      marketScope: input.marketScope,
    },
  });
}

export async function activateRetailGrowth(email: string, projectId: string) {
  const context = await clientProjectContext(email, projectId);
  if (context.role !== "client_admin")
    throw new ApiError(
      "Only the business owner can start automation.",
      403,
      "ROLE_FORBIDDEN",
    );
  const [profile, website] = await Promise.all([
    context.db
      .from("client_growth_profiles")
      .select("monthly_budget,service_areas,onboarding_status")
      .eq("project_id", projectId)
      .maybeSingle(),
    context.db
      .from("websites")
      .select("id")
      .eq("project_id", projectId)
      .eq("is_primary", true)
      .maybeSingle(),
  ]);
  if (!profile.data || !website.data)
    throw new ApiError(
      "Finish the business profile before starting HD SEO.",
      409,
      "ONBOARDING_INCOMPLETE",
    );
  const bucket = new Date().toISOString().slice(0, 10),trialKey=`trial-crawl:${projectId}`;
  const crawlAccess=await claimWebsiteCrawlAccess(context.db,{projectId,idempotencyKey:trialKey});
  let evidenceJobId:string;
  try{
    evidenceJobId = await enqueueEvidenceJob(context.db, {
      agencyId: context.agencyId,
      clientId: context.clientId,
      projectId,
      websiteId: website.data.id,
      jobType: "crawler.crawl",
      payload:crawlAccess.mode==="trial"?{maxPages:25,trial:true}:{},
      idempotencyKey: crawlAccess.mode==="trial"?trialKey:`retail-crawl:${projectId}:${bucket}`,
      priority: 95,
    });
  }catch(error){
    await releaseTrialCrawlClaim(context.db,crawlAccess,"QUEUE_FAILED");
    throw error;
  }
  await markTrialCrawlQueued(context.db,crawlAccess,evidenceJobId);
  const serviceAreas = Array.isArray(profile.data.service_areas)
    ? profile.data.service_areas
    : [];
  const monthlyBudget = Number(profile.data.monthly_budget) || 99;
  const targetMarket = serviceAreas[0] ?? context.primaryMarket ?? "United States";
  let existingOpportunityCount = 0;
  if (crawlAccess.mode !== "trial") {
    const existingOpportunities = await context.db
      .from("seo_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", context.agencyId)
      .eq("project_id", projectId);
    if (existingOpportunities.error) {
      throw new ApiError(
        "Existing keyword opportunities could not be inspected safely.",
        500,
        "DATABASE_BINDING_FAILED",
      );
    }
    existingOpportunityCount = existingOpportunities.count ?? 0;
  }
  const discovery = crawlAccess.mode === "trial" || existingOpportunityCount > 0
    ? null
    : await discoverKeywordOpportunitiesForActor(
        email,
        {
          projectId,
          monthlyBudget,
          targetMarket,
          limit: 50,
        },
        {
          db: context.db,
          agencyId: context.agencyId,
          userId: context.userId,
        },
      );
  const agentWork = crawlAccess.mode === "trial"
    ? []
    : await (async () => {
        const tenant = {
          agencyId: context.agencyId,
          clientId: context.clientId,
          projectId,
          userId: context.userId,
        };
        const managed = await requestManagedAgentServiceCycle(context.db, tenant);
        const resumed = await resumeEvidenceBlockedAgentWork(context.db, {
          agencyId: context.agencyId,
          projectId,
          recoveryKey: discovery?.jobId ?? bucket,
          allowedTools: managed.allowedTools,
        });
        const cycle = await runManagedAgentCycle(context.db, {
          agencyId: context.agencyId,
          clientId: context.clientId,
          projectId,
          requestedBy: context.userId,
        });
        return [{
          managed: true,
          resumed,
          cycle,
          evidenceJobId,
          discoveryJobId: discovery?.jobId ?? null,
          billableDefinition: "one verified customer-visible outcome",
        }];
      })();
  const now = nowIso();
  await Promise.all([
    context.db
      .from("client_growth_profiles")
      .update({
        onboarding_status: "active",
        onboarding_step: 7,
        last_owner_reviewed_at: now,
        updated_at: now,
      })
      .eq("project_id", projectId),
    context.db
      .from("client_organizations")
      .update({ status: "active", updated_at: now })
      .eq("id", context.clientId),
    context.db
      .from("clients")
      .update({ status: "active", updated_at: now })
      .eq("organization_id", context.clientId),
  ]);
  await recordEvent(context.db, {
    agencyId: context.agencyId,
    clientOrganizationId: context.clientId,
    projectId,
    eventType: crawlAccess.mode==="trial"?"retail_trial_crawl_started":"retail_growth_started",
    title: crawlAccess.mode==="trial"?"Your free website crawl started":"Your HD SEO agent team started working",
    description: crawlAccess.mode==="trial"
      ? "HD SEO queued the one included public crawl of up to 25 pages. Paid data, publishing, and ongoing automation remain off during the free trial."
      : "Website analysis and service-area research are queued. Sensitive changes will still pause for your approval.",
    actorUserId: context.userId,
    actorEmail: email,
    clientVisible: true,
  });
  return { evidenceJobId, agentWork, crawlMode:crawlAccess.mode };
}

export async function createClientSupportRequest(
  email: string,
  input: {
    projectId: string;
    category: string;
    subject: string;
    message: string;
  },
) {
  const context = await clientProjectContext(email, input.projectId);
  const created = await context.db
    .from("client_support_requests")
    .insert({
      agency_id: context.agencyId,
      client_organization_id: context.clientId,
      project_id: input.projectId,
      requested_by: context.userId,
      category: input.category,
      subject: input.subject.trim(),
      message: input.message.trim(),
    })
    .select("id")
    .single();
  if (created.error || !created.data)
    throw new ApiError(
      "Your question could not be sent. Apply migration 0022 and retry.",
      500,
      "DATABASE_BINDING_FAILED",
    );
  return created.data.id as string;
}

function onboardingSlug(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || crypto.randomUUID().slice(0, 8)
  );
}

async function onboardingConfig(db: SupabaseClient, clientId: string) {
  const result = await db
    .from("clients")
    .select("automation_config")
    .eq("organization_id", clientId)
    .maybeSingle();
  return asRecord(result.data?.automation_config);
}

async function updateOnboardingConfig(
  db: SupabaseClient,
  clientId: string,
  patch: Record<string, unknown>,
) {
  const current = await onboardingConfig(db, clientId);
  const result = await db
    .from("clients")
    .update({
      automation_config: { ...current, ...patch },
      updated_at: nowIso(),
    })
    .eq("organization_id", clientId);
  if (result.error)
    throw new ApiError(
      "The client onboarding progress could not be saved.",
      500,
      "DATABASE_BINDING_FAILED",
    );
}

export async function analyzeOnboardingWebsite(
  email: string,
  domain: string,
): Promise<WebsitePlatformAnalysis> {
  const { role } = await agencyContext(email);
  requireLivePermission(role, "clients.manage");
  return detectWebsitePlatform(domain);
}

export async function createClientOnboarding(
  email: string,
  input: ClientOnboardingInput,
): Promise<{
  clientId: string;
  projectId: string;
  websiteId: string;
  analysis: WebsitePlatformAnalysis;
}> {
  const analysis = await analyzeOnboardingWebsite(email, input.domain);
  const created = await createClientWithProject(email, input);
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "clients.manage");
  const now = nowIso();
  const services = [
    ...new Set(input.services.map((item) => item.trim()).filter(Boolean)),
  ].slice(0, 30);
  const serviceAreas = [
    ...new Set(input.serviceAreas.map((item) => item.trim()).filter(Boolean)),
  ].slice(0, 50);
  if (input.marketScope === "service_area" && !serviceAreas.length) {
    throw new ApiError(
      "Add at least one city or service area, or choose Nationwide.",
      422,
      "SERVICE_AREA_REQUIRED",
    );
  }
  const config = {
    onboardingVersion: 1,
    onboardingStatus: "connections",
    monthlyBudget: input.monthlyBudget,
    targetMarket: input.targetMarket,
    marketScope: input.marketScope,
    services,
    serviceAreas,
    phone: input.phone?.trim() || null,
    automationLevel: "safe",
    detectedPlatform: analysis.platform,
    platformLabel: analysis.platformLabel,
    platformConfidence: analysis.confidence,
    websiteReachable: analysis.reachable,
    approvalRequired: true,
    safeChangesAutomatic: true,
    autoRollback: true,
  };
  const [projectResult, websiteResult, clientResult] = await Promise.all([
    db
      .from("seo_projects")
      .update({
        primary_market:
          input.marketScope === "nationwide"
            ? "United States"
            : input.targetMarket,
        market_scope: input.marketScope,
        industry: services[0] ?? null,
        data_readiness_status: "collecting",
        updated_at: now,
      })
      .eq("id", created.projectId)
      .eq("agency_id", agencyId),
    db
      .from("websites")
      .update({
        site_url: analysis.siteUrl,
        canonical_domain: analysis.canonicalDomain,
        cms_type: analysis.platform,
        status: analysis.reachable ? "active" : "connection_required",
        last_verified_at: analysis.reachable ? now : null,
        updated_at: now,
      })
      .eq("id", created.websiteId)
      .eq("agency_id", agencyId),
    db.from("clients").upsert(
      {
        id: created.clientId,
        agency_id: agencyId,
        organization_id: created.clientId,
        name: input.name,
        status: "onboarding",
        automation_config: config,
        updated_at: now,
      },
      { onConflict: "organization_id" },
    ),
  ]);
  if (projectResult.error || websiteResult.error || clientResult.error) {
    throw new ApiError(
      "The business was created, but its onboarding profile could not be completed.",
      500,
      "DATABASE_BINDING_FAILED",
    );
  }
  if (services.length) {
    const saved = await db.from("seo_services").insert(
      services.map((name, index) => ({
        agency_id: agencyId,
        client_organization_id: created.clientId,
        project_id: created.projectId,
        name,
        slug: `${onboardingSlug(name)}-${index + 1}`,
        category: "core_service",
        priority: Math.max(50, 100 - index * 5),
        status: "active",
      })),
    );
    if (saved.error)
      throw new ApiError(
        "The business services could not be saved.",
        500,
        "DATABASE_BINDING_FAILED",
      );
  }
  if (serviceAreas.length) {
    const saved = await db.from("seo_locations").insert(
      serviceAreas.map((name, index) => ({
        agency_id: agencyId,
        client_organization_id: created.clientId,
        project_id: created.projectId,
        name,
        city: name,
        country_code: "US",
        priority: Math.max(50, 100 - index * 3),
        status: "active",
      })),
    );
    if (saved.error)
      throw new ApiError(
        "The service areas could not be saved.",
        500,
        "DATABASE_BINDING_FAILED",
      );
  }
  if (analysis.reachable) {
    const connected = await db.from("cms_connections").upsert(
      {
        agency_id: agencyId,
        client_organization_id: created.clientId,
        project_id: created.projectId,
        website_id: created.websiteId,
        cms_type: analysis.platform,
        editor_mode: "read_only",
        site_url: analysis.siteUrl,
        connection_mode: "monitor_only",
        status: "active",
        encrypted_secret_reference: null,
        last_verified_at: now,
        updated_at: now,
      },
      { onConflict: "project_id,site_url" },
    );
    if (connected.error)
      throw new ApiError(
        "The no-login website monitoring connection could not be saved.",
        500,
        "DATABASE_BINDING_FAILED",
      );
  }
  await recordEvent(db, {
    agencyId,
    clientOrganizationId: created.clientId,
    projectId: created.projectId,
    eventType: "client_onboarding_started",
    title: `${input.name} onboarding started`,
    description: `${analysis.platformLabel} detected. HD SEO is ready to monitor ${analysis.canonicalDomain} without requiring technical access.`,
    actorUserId: userId,
    actorEmail: email,
  });
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: "client.onboarding.created",
    resourceType: "seo_project",
    resourceId: created.projectId,
    afterState: { ...config, websiteId: created.websiteId },
  });
  return { ...created, analysis };
}

export async function setClientOnboardingAutomation(
  email: string,
  input: {
    projectId: string;
    automationLevel: "recommend" | "safe" | "autopilot";
  },
) {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "clients.manage");
  const project = await db
    .from("seo_projects")
    .select("id,client_organization_id")
    .eq("id", input.projectId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!project.data)
    throw new ApiError("Client project not found.", 404, "NOT_FOUND");
  await updateOnboardingConfig(db, project.data.client_organization_id, {
    onboardingStatus: "ready",
    automationLevel: input.automationLevel,
    approvalRequired: input.automationLevel !== "autopilot",
    safeChangesAutomatic: input.automationLevel !== "recommend",
    highRiskApprovalRequired: true,
    updatedBy: userId,
  });
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: "client.onboarding.automation_selected",
    resourceType: "seo_project",
    resourceId: input.projectId,
    afterState: { automationLevel: input.automationLevel },
  });
}

export async function launchClientOnboarding(email: string, projectId: string) {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "clients.manage", "provider.authorize");
  const project = await db
    .from("seo_projects")
    .select("id,client_organization_id,primary_market")
    .eq("id", projectId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!project.data)
    throw new ApiError("Client project not found.", 404, "NOT_FOUND");
  const config = await onboardingConfig(
    db,
    project.data.client_organization_id,
  );
  const monthlyBudget =
    typeof config.monthlyBudget === "number" ? config.monthlyBudget : 1500;
  const targetMarket =
    typeof config.targetMarket === "string"
      ? config.targetMarket
      : project.data.primary_market || "United States";
  const website = await db
    .from("websites")
    .select("id")
    .eq("project_id", projectId)
    .eq("agency_id", agencyId)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();
  if (!website.data)
    throw new ApiError(
      "The client website is missing.",
      409,
      "WEBSITE_CONNECTION_FAILED",
    );
  const bucket = new Date().toISOString().slice(0, 13);
  const evidenceJobs: string[] = [];
  evidenceJobs.push(
    await enqueueEvidenceJob(db, {
      agencyId,
      clientId: project.data.client_organization_id,
      projectId,
      websiteId: website.data.id,
      jobType: "crawler.crawl",
      idempotencyKey: `onboarding-crawl:${projectId}:${bucket}`,
      priority: 90,
    }),
  );
  const google = await db
    .from("integration_connections")
    .select("id,status,selected_resource")
    .eq("project_id", projectId)
    .eq("agency_id", agencyId)
    .eq("provider", "google_search_console")
    .maybeSingle();
  if (google.data?.status === "active" && google.data.selected_resource) {
    evidenceJobs.push(
      ...(await Promise.all([
        enqueueEvidenceJob(db, {
          agencyId,
          clientId: project.data.client_organization_id,
          projectId,
          connectionId: google.data.id,
          jobType: "google.search_analytics",
          idempotencyKey: `onboarding-gsc-analytics:${projectId}:${bucket}`,
          priority: 85,
        }),
        enqueueEvidenceJob(db, {
          agencyId,
          clientId: project.data.client_organization_id,
          projectId,
          connectionId: google.data.id,
          jobType: "google.sitemaps",
          idempotencyKey: `onboarding-gsc-sitemaps:${projectId}:${bucket}`,
          priority: 75,
        }),
      ])),
    );
  }
  const discovery = await discoverKeywordOpportunities(email, {
    projectId,
    monthlyBudget,
    targetMarket,
    limit: 50,
  });
  const launchedAt = nowIso();
  const agentWorkItems = await seedOnboardingAgentTeam(
    db,
    {
      agencyId,
      clientId: project.data.client_organization_id,
      projectId,
      userId,
    },
    {
      evidenceJobIds: evidenceJobs,
      discoveryJobId: discovery.jobId,
      monthlyBudget,
      targetMarket,
      launchKey: projectId,
    },
  );
  await updateOnboardingConfig(db, project.data.client_organization_id, {
    onboardingStatus: "launched",
    launchedAt,
    firstEvidenceJobIds: evidenceJobs,
    firstDiscoveryJobId: discovery.jobId,
    firstAgentWorkItemIds: agentWorkItems.map((item) => item.workItemId),
  });
  await Promise.all([
    db
      .from("clients")
      .update({ status: "active", updated_at: launchedAt })
      .eq("organization_id", project.data.client_organization_id),
    db
      .from("seo_projects")
      .update({ data_readiness_status: "collecting", updated_at: launchedAt })
      .eq("id", projectId)
      .eq("agency_id", agencyId),
  ]);
  await recordEvent(db, {
    agencyId,
    clientOrganizationId: project.data.client_organization_id,
    projectId,
    eventType: "client_onboarding_launched",
    title: "Autonomous SEO launched",
    description: `Website evidence collection and keyword discovery started for a $${monthlyBudget.toLocaleString()} monthly budget.`,
    actorUserId: userId,
    actorEmail: email,
    clientVisible: true,
  });
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: "client.onboarding.launched",
    resourceType: "seo_project",
    resourceId: projectId,
    afterState: {
      evidenceJobs,
      discoveryJobId: discovery.jobId,
      monthlyBudget,
      targetMarket,
    },
  });
  return { evidenceJobs, discovery, agentWorkItems };
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
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "seo.write");
  const { data: project } = await db
    .from("seo_projects")
    .select("id,client_organization_id")
    .eq("id", input.projectId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!project) throw new ApiError("Project not found.", 404, "NOT_FOUND");
  const serviceAreaPolicy = await loadProjectServiceAreaPolicy(db, project.id);
  const geographic = assessKeywordServiceArea(input.keyword, serviceAreaPolicy);
  if (!geographic.allowed) {
    throw new ApiError(
      `That keyword names a location outside this client's configured service area (${serviceAreaPolicy.serviceAreas.map((area) => area.name).join(", ")}).`,
      422,
      "LOCATION_EXCLUDED",
    );
  }

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
    reason_codes: [input.actionType, ...geographic.reasonCodes],
    evidence: {
      keyword: input.keyword,
      current_rank: input.currentRank ?? null,
      target_rank: input.targetRank,
      reason: input.reason,
      target_market: serviceAreaPolicy.targetMarket,
      service_areas: serviceAreaPolicy.serviceAreas.map((area) => area.name),
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
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: "opportunity.created",
    resourceType: "seo_opportunity",
    afterState: { projectId: input.projectId, keyword: input.keyword },
  });
}

export type KeywordDiscoverySummary = {
  analyzed: number;
  selected: number;
  providerCost: number;
  monthlyBudget: number;
  jobId: string | null;
  jobStatus: string | null;
  targetMarket: string;
  excludedOutsideServiceArea: number;
};

type KeywordDiscoveryInput = {
  projectId: string;
  monthlyBudget: number;
  targetMarket?: string;
  marketScope?: "service_area" | "nationwide";
  limit: number;
};

type KeywordDiscoveryActor = {
  db: SupabaseClient;
  agencyId: string;
  userId: string;
};

export async function discoverKeywordOpportunities(
  email: string,
  input: KeywordDiscoveryInput,
): Promise<KeywordDiscoverySummary> {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "provider.authorize");
  return discoverKeywordOpportunitiesForActor(email, input, {
    db,
    agencyId,
    userId,
  });
}

async function discoverKeywordOpportunitiesForActor(
  email: string,
  input: KeywordDiscoveryInput,
  actor: KeywordDiscoveryActor,
): Promise<KeywordDiscoverySummary> {
  if (!hasDataForSeoConfig) {
    throw new ApiError(
      "Keyword discovery needs the DataForSEO connection configured by an administrator.",
      503,
      "NOT_CONFIGURED",
    );
  }

  const { db, agencyId, userId } = actor;
  const { data: project } = await db
    .from("seo_projects")
    .select(
      "id,name,domain,primary_market,market_scope,client_organization_id,country_code,language_code",
    )
    .eq("id", input.projectId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!project) throw new ApiError("Project not found.", 404, "NOT_FOUND");

  const marketScope =
    input.marketScope ??
    (project.market_scope === "nationwide" ? "nationwide" : "service_area");
  if (marketScope === "service_area") {
    const locations = await db
      .from("seo_locations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("status", "active");
    if (locations.error) throw locations.error;
    if (!locations.count)
      throw new ApiError(
        "Add at least one city or service area before using service-area discovery.",
        422,
        "SERVICE_AREA_REQUIRED",
      );
  }
  if (marketScope !== project.market_scope) {
    const marketWrite = await db
      .from("seo_projects")
      .update({
        market_scope: marketScope,
        primary_market:
          marketScope === "nationwide"
            ? "United States"
            : project.primary_market,
        updated_at: nowIso(),
      })
      .eq("id", project.id)
      .eq("agency_id", agencyId);
    if (marketWrite.error)
      throw new ApiError(
        "The market scope could not be saved. Apply migration 0023 and retry.",
        500,
        "DATABASE_BINDING_FAILED",
      );
  }

  const serviceAreaPolicy = await loadProjectServiceAreaPolicy(
    db,
    project.id,
    input.targetMarket,
  );
  const excludedOutsideServiceArea = await quarantineOutOfAreaKeywords(
    db,
    project.id,
    serviceAreaPolicy,
  );
  const targetMarket = serviceAreaPolicy.targetMarket;
  const providerLocation = await resolveLabsLocation(
    project.country_code || "US",
    project.language_code || "en",
  );

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
    targetMarket,
    locationCode: providerLocation.locationCode,
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

  const paidTenantContext = {
    user: { id: userId },
    agency: { id: agencyId },
    client: { id: project.client_organization_id },
    project: { id: project.id },
  };

  let paid: Awaited<ReturnType<typeof beginPaidOperation>> | null = null;
  try {
    paid = await beginPaidOperation(paidTenantContext, {
      confirmationId: confirmation.id,
      operation,
      estimatedUnits: limit,
      estimatedCost,
      scopeHash,
    });
    const providerInput = {
      target: discoveryDomain,
      limit,
      locationCode: providerLocation.locationCode,
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
      serviceAreaPolicy,
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
        service_id: candidate.serviceId,
        location_id: candidate.locationId,
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
              service_id: candidate.serviceId,
              location_id: candidate.locationId,
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
      const rankingRows = candidates
        .filter((candidate) => candidate.currentRank != null)
        .map((candidate) => ({
          agency_id: agencyId,
          client_organization_id: project.client_organization_id,
          project_id: project.id,
          keyword_id: keywordIds.get(candidate.normalizedKeyword),
          position: candidate.currentRank,
          ranking_url: candidate.rankingUrl,
          search_engine: "google",
          device: "desktop",
          location_code: targetMarket,
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
      const reason = `HD SEO found this from ${project.domain} in the configured ${marketScope === "nationwide" ? "nationwide" : targetMarket} market: ${candidate.searchVolume.toLocaleString()} monthly searches, $${candidate.cpc.toFixed(2)} CPC, ${candidate.currentRank == null ? "an untapped keyword" : `current rank #${candidate.currentRank}`}, and an estimated ${candidate.valuePerDollar.toFixed(2)} value-to-effort ratio within the $${input.monthlyBudget.toLocaleString()} monthly SEO budget.`;
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
          target_market: targetMarket,
          market_scope: marketScope,
          service_areas: serviceAreaPolicy.serviceAreas.map(
            (area) => area.name,
          ),
          location_relevance: candidate.locationRelevance,
          service_relevance: candidate.serviceRelevance,
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
        ? await db
            .from("seo_opportunities")
            .update(values)
            .eq("id", opportunityId)
        : await db
            .from("seo_opportunities")
            .insert({ ...values, status: "open" });
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
        target_market: targetMarket,
        market_scope: marketScope,
        service_areas: serviceAreaPolicy.serviceAreas.map((area) => area.name),
        discovery_limit: limit,
        human_approval_required: true,
      },
      updated_at: nowIso(),
    };
    const campaignWrite = campaign
      ? await db
          .from("seo_campaigns")
          .update(campaignValues)
          .eq("id", campaign.id)
          .select("id")
          .single()
      : await db
          .from("seo_campaigns")
          .insert({
            ...campaignValues,
            agency_id: agencyId,
            client_organization_id: project.client_organization_id,
            project_id: project.id,
            name: `${project.name} SEO Value Plan`,
            reserve_budget: 0,
            created_by: userId,
          })
          .select("id")
          .single();
    if (campaignWrite.error || !campaignWrite.data) {
      throw campaignWrite.error ?? new Error("Campaign could not be saved.");
    }

    let { data: activeJob } = await db
      .from("seo_campaign_jobs")
      .select("id,status")
      .eq("project_id", project.id)
      .not("status", "in", "(completed,failed,cancelled,stale)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!activeJob && candidates.length) {
      const referenceId = crypto.randomUUID();
      const queued = await db
        .from("seo_campaign_jobs")
        .insert({
          agency_id: agencyId,
          client_organization_id: project.client_organization_id,
          project_id: project.id,
          campaign_id: campaignWrite.data.id,
          requested_by: userId,
          status: "queued",
          current_stage: "discover",
          input: {
            automationMode: "PREPARE",
            minimumConfidence: 55,
            monthlyBudget: input.monthlyBudget,
            targetMarket,
            discoveryLimit: limit,
            automaticDiscoveryCompleted: true,
          },
          idempotency_key: `live-discovery:${project.id}:${referenceId}`,
          reference_id: referenceId,
        })
        .select("id,status")
        .single();
      if (queued.error && queued.error.code !== "23505") throw queued.error;
      activeJob = queued.data ?? null;
      if (!activeJob) {
        activeJob = (
          await db
            .from("seo_campaign_jobs")
            .select("id,status")
            .eq("project_id", project.id)
            .not("status", "in", "(completed,failed,cancelled,stale)")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        ).data;
      }
    }

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
      description: `HD SEO analyzed ${analyzed} site-relevant keyword records for ${targetMarket} and prioritized the strongest opportunities for a $${input.monthlyBudget.toLocaleString()} monthly budget.`,
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
    await recordAudit(db, {
      agencyId,
      actorUserId: userId,
      action: "keyword_discovery.completed",
      resourceType: "seo_project",
      resourceId: project.id,
      afterState: {
        analyzed,
        selected: candidates.length,
        providerCost,
        monthlyBudget: input.monthlyBudget,
        jobId: activeJob?.id ?? null,
        targetMarket,
        excludedOutsideServiceArea,
      },
    });
    if (candidates.length) {
      await wakeManagedAgentService(db, {
        agencyId,
        clientId: project.client_organization_id,
        projectId: project.id,
        reason: "opportunity_ready",
      });
    }
    return {
      analyzed,
      selected: candidates.length,
      providerCost,
      monthlyBudget: input.monthlyBudget,
      jobId: activeJob?.id ?? null,
      jobStatus: activeJob?.status ?? null,
      targetMarket,
      excludedOutsideServiceArea,
    };
  } catch (error) {
    if (paid) {
      await finishPaidOperation(paid, {
        cost: 0,
        units: 0,
        status: "failed",
        error:
          error instanceof Error ? error.message : "Keyword discovery failed",
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
  input: { opportunityId: string; implementationPath: ImplementationChoice },
): Promise<{ message: string }> {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "seo.write");
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

  if (input.implementationPath === "monitoring_only") {
    await Promise.all([
      db
        .from("seo_opportunities")
        .update({ status: "monitoring", updated_at: nowIso() })
        .eq("id", input.opportunityId)
        .eq("agency_id", agencyId),
      db.from("seo_tasks").insert({
        agency_id: agencyId,
        client_organization_id: project.client_organization_id,
        project_id: project.id,
        title: `Monitor ${String(asRecord(opp.evidence).keyword ?? opp.opportunity_key ?? "SEO opportunity")}`,
        status: "ready",
        priority: "medium",
        created_by: userId,
        completion_proof: {
          opportunity_id: input.opportunityId,
          assigned_email: email,
          implementation_path: "monitoring_only",
        },
      }),
    ]);
    await recordEvent(db, {
      agencyId,
      clientOrganizationId: project.client_organization_id,
      projectId: project.id,
      eventType: "monitoring_only_selected",
      title: "Monitoring-only workflow started",
      description:
        "HD SEO will keep measuring this opportunity without changing the website.",
      actorUserId: userId,
      actorEmail: email,
      clientVisible: true,
    });
    await recordAudit(db, {
      agencyId,
      actorUserId: userId,
      action: "implementation.monitoring_only_selected",
      resourceType: "seo_opportunity",
      resourceId: input.opportunityId,
      afterState: { projectId: project.id },
    });
    return { message: "Monitoring started. No website changes will be made." };
  }

  if (
    input.implementationPath === "repository_pr" ||
    input.implementationPath === "repository_vercel"
  ) {
    requireLivePermission(role, "execution.approve");
    const readiness = await db.rpc("github_execution_readiness", {
      target_agency: agencyId,
      target_project: project.id,
    });
    if (!readiness.data?.ready) {
      throw new ApiError(
        `GitHub execution needs setup: ${(readiness.data?.blockers ?? []).join(", ")}.`,
        409,
        "CONFLICT",
      );
    }
    if (input.implementationPath === "repository_vercel") {
      const vercel = await db
        .from("vercel_projects")
        .select("id")
        .eq("agency_id", agencyId)
        .eq("project_id", project.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (!vercel.data) {
        throw new ApiError(
          "Connect this project to Vercel before selecting GitHub + Vercel deployment.",
          409,
          "NOT_CONFIGURED",
        );
      }
    }
    const activeJob = await db
      .from("seo_campaign_jobs")
      .select("id")
      .eq("project_id", project.id)
      .not("status", "in", "(completed,failed,cancelled,stale)")
      .limit(1)
      .maybeSingle();
    if (activeJob.data) {
      throw new ApiError(
        "This client already has an active automation run. Finish or cancel it before starting another repository change.",
        409,
        "CONFLICT",
      );
    }
    const referenceId = crypto.randomUUID();
    const queued = await db
      .from("seo_campaign_jobs")
      .insert({
        agency_id: agencyId,
        client_organization_id: project.client_organization_id,
        project_id: project.id,
        requested_by: userId,
        status: "queued",
        current_stage: "inspect_repository",
        input: {
          automationMode: "EXECUTE_WITH_APPROVAL",
          deliveryMode: input.implementationPath,
        },
        result: { opportunityId: input.opportunityId },
        idempotency_key: `repository:${project.id}:${input.opportunityId}:${referenceId}`,
        reference_id: referenceId,
      })
      .select("id")
      .single();
    if (!queued.data) {
      throw new ApiError(
        "The repository execution could not be queued.",
        500,
        "OPERATION_FAILED",
      );
    }
    await db
      .from("seo_opportunities")
      .update({ status: "approved", updated_at: nowIso() })
      .eq("id", input.opportunityId)
      .eq("agency_id", agencyId);
    await recordEvent(db, {
      agencyId,
      clientOrganizationId: project.client_organization_id,
      projectId: project.id,
      eventType: "repository_execution_queued",
      title:
        input.implementationPath === "repository_vercel"
          ? "GitHub + Vercel workflow queued"
          : "GitHub pull request workflow queued",
      description:
        "HD SEO will inspect the repository, prepare a bounded change, and pause for human approval before writing code.",
      actorUserId: userId,
      actorEmail: email,
      clientVisible: true,
    });
    await recordAudit(db, {
      agencyId,
      actorUserId: userId,
      action: "repository_execution.queued",
      resourceType: "seo_campaign_job",
      resourceId: queued.data.id,
      afterState: {
        opportunityId: input.opportunityId,
        deliveryMode: input.implementationPath,
      },
    });
    return {
      message:
        input.implementationPath === "repository_vercel"
          ? "GitHub change queued. HD SEO will prepare the pull request and track its Vercel deployment."
          : "GitHub change queued. HD SEO will pause for approval before creating the pull request.",
    };
  }

  const evidence = asRecord(opp.evidence);
  const keyword =
    (evidence.keyword as string) ?? (opp.opportunity_key as string) ?? "";
  const directProvider = input.implementationPath.endsWith("_direct")
    ? input.implementationPath.replace("_direct", "")
    : null;
  if (directProvider) {
    const connection = await db
      .from("cms_connections")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("project_id", project.id)
      .eq("cms_type", directProvider)
      .eq("status", "active")
      .not("last_verified_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (!connection.data) {
      throw new ApiError(
        `Connect and verify ${directProvider} before selecting automatic publishing.`,
        409,
        "WEBSITE_CONNECTION_FAILED",
      );
    }
  }
  const path = (
    input.implementationPath === "wordpress_direct"
      ? "wordpress_package"
      : ["shopify_direct", "webflow_direct", "squarespace_guided"].includes(
            input.implementationPath,
          )
        ? "generic_cms"
        : input.implementationPath
  ) as "wordpress_package" | "generic_cms" | "developer_ticket";
  const delivery = directProvider
    ? {
        mode: "direct_cms",
        provider: directProvider,
        label: `Publish automatically to ${directProvider}`,
        approvalRequired: true,
      }
    : input.implementationPath === "squarespace_guided"
      ? {
          mode: "guided",
          provider: "squarespace",
          label: "Squarespace guided implementation",
          approvalRequired: true,
        }
      : {
          mode: "manual_handoff",
          provider: path === "wordpress_package" ? "wordpress" : null,
          label:
            path === "developer_ticket"
              ? "Developer handoff"
              : path === "wordpress_package"
                ? "WordPress implementation package"
                : "CMS implementation package",
          approvalRequired: true,
        };
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
      status: "awaiting_agency_review",
      package_data: {
        ...packageData,
        title: `${keyword} implementation`,
        delivery,
      },
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
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: "implementation_package.created",
    resourceType: "implementation_package",
    resourceId: pkg.id,
    afterState: {
      opportunityId: input.opportunityId,
      path,
      deliveryMode: delivery.mode,
      provider: delivery.provider,
    },
  });
  return {
    message:
      delivery.mode === "direct_cms"
        ? `${directProvider} publishing package created. It will require approval before HD SEO writes to the website.`
        : `${delivery.label} created for review.`,
  };
}

export async function updateTaskStatus(
  email: string,
  input: { taskId: string; status: string },
): Promise<void> {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "task.manage", "task.update");
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
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: "seo_task.status_updated",
    resourceType: "seo_task",
    resourceId: input.taskId,
    afterState: { status: input.status },
  });
}

export async function controlCampaignJob(
  email: string,
  input: { jobId: string; command: "cancel" | "retry" },
): Promise<void> {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "execution.approve");
  const { data: job } = await db
    .from("seo_campaign_jobs")
    .select("id,status,attempt_count,max_attempts")
    .eq("id", input.jobId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!job) throw new ApiError("Automation run not found.", 404, "NOT_FOUND");

  if (input.command === "cancel") {
    if (["completed", "failed", "cancelled", "stale"].includes(job.status)) {
      throw new ApiError(
        "This automation run is already finished.",
        409,
        "CONFLICT",
      );
    }
    await db
      .from("seo_campaign_jobs")
      .update({
        status: "cancelled",
        worker_id: null,
        locked_at: null,
        lock_expires_at: null,
        updated_at: nowIso(),
      })
      .eq("id", input.jobId)
      .eq("agency_id", agencyId);
  } else {
    if (
      !["failed", "stale"].includes(job.status) ||
      job.attempt_count >= job.max_attempts
    ) {
      throw new ApiError(
        "This automation run cannot be retried safely.",
        409,
        "CONFLICT",
      );
    }
    await db
      .from("seo_campaign_jobs")
      .update({
        status: "queued",
        error_code: null,
        error_message: null,
        error_details: {},
        worker_id: null,
        locked_at: null,
        lock_expires_at: null,
        next_attempt_at: nowIso(),
        failed_at: null,
        updated_at: nowIso(),
      })
      .eq("id", input.jobId)
      .eq("agency_id", agencyId);
  }
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: `automation_run.${input.command}`,
    resourceType: "seo_campaign_job",
    resourceId: input.jobId,
    afterState: { status: input.command === "cancel" ? "cancelled" : "queued" },
  });
}

export async function reviewCampaignJob(
  email: string,
  input: { jobId: string; decision: "proceed" | "dismiss" },
): Promise<void> {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "draft.approve");
  const { data: job } = await db
    .from("seo_campaign_jobs")
    .select("id,status,project_id,client_organization_id,result")
    .eq("id", input.jobId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!job) throw new ApiError("Automation run not found.", 404, "NOT_FOUND");
  if (job.status !== "awaiting_opportunity_review") {
    throw new ApiError(
      "This automation run is not awaiting a recommendation decision.",
      409,
      "CONFLICT",
    );
  }
  const result = asRecord(job.result);
  const opportunityId =
    typeof result.opportunityId === "string" ? result.opportunityId : null;
  const draftId = typeof result.draftId === "string" ? result.draftId : null;
  if (!opportunityId || !draftId) {
    throw new ApiError(
      "The selected recommendation is unavailable.",
      409,
      "CONFLICT",
    );
  }

  if (input.decision === "dismiss") {
    await Promise.all([
      db
        .from("seo_campaign_jobs")
        .update({ status: "cancelled", updated_at: nowIso() })
        .eq("id", input.jobId)
        .eq("status", "awaiting_opportunity_review"),
      db
        .from("seo_opportunities")
        .update({ status: "dismissed", updated_at: nowIso() })
        .eq("id", opportunityId)
        .eq("agency_id", agencyId),
    ]);
  } else {
    const { data: draft } = await db
      .from("seo_action_drafts")
      .select("execution_path")
      .eq("id", draftId)
      .eq("project_id", job.project_id)
      .maybeSingle();
    if (!draft) {
      throw new ApiError(
        "The implementation draft is unavailable.",
        409,
        "CONFLICT",
      );
    }
    if (draft.execution_path === "repository") {
      requireLivePermission(role, "execution.approve");
      const readiness = await db.rpc("github_execution_readiness", {
        target_agency: agencyId,
        target_project: job.project_id,
      });
      if (!readiness.data?.ready) {
        throw new ApiError(
          `Repository execution is blocked: ${(readiness.data?.blockers ?? []).join(", ")}.`,
          409,
          "CONFLICT",
        );
      }
      await db
        .from("seo_campaign_jobs")
        .update({
          status: "queued",
          current_stage: "inspect_repository",
          next_attempt_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", input.jobId)
        .eq("status", "awaiting_opportunity_review");
      await db
        .from("seo_opportunities")
        .update({ status: "approved", updated_at: nowIso() })
        .eq("id", opportunityId)
        .eq("agency_id", agencyId);
    } else {
      const created = await createManualPackage(db, {
        agencyId,
        clientId: job.client_organization_id,
        projectId: job.project_id,
        opportunityId,
        draftId,
        createdBy: userId,
        requestedPath: draft.execution_path,
      });
      await Promise.all([
        db
          .from("seo_campaign_jobs")
          .update({
            status: "awaiting_manual_completion",
            progress_percent: 75,
            result: {
              ...result,
              packageId: created.id,
              taskId: created.taskId,
            },
            updated_at: nowIso(),
          })
          .eq("id", input.jobId)
          .eq("status", "awaiting_opportunity_review"),
        db
          .from("seo_opportunities")
          .update({ status: "in_progress", updated_at: nowIso() })
          .eq("id", opportunityId)
          .eq("agency_id", agencyId),
      ]);
    }
  }
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: `automation_run.recommendation_${input.decision}`,
    resourceType: "seo_campaign_job",
    resourceId: input.jobId,
    afterState: { opportunityId },
  });
}

export async function advancePackage(
  email: string,
  packageId: string,
  action:
    | "approve_package"
    | "publish_package"
    | "mark_implemented"
    | "verify_package",
  details: {
    liveUrl?: string;
    proof?: Record<string, unknown>;
    checks?: Record<string, boolean>;
  } = {},
): Promise<void> {
  const { db, agencyId, userId, role } = await agencyContext(email);
  if (action === "approve_package") {
    requireLivePermission(role, "draft.approve");
  } else if (action === "publish_package") {
    requireLivePermission(role, "client_portal.manage");
  } else if (action === "mark_implemented") {
    requireLivePermission(role, "seo.write", "execution.edit");
  } else {
    requireLivePermission(role, "execution.approve");
  }
  const { data: pkg } = await db
    .from("implementation_packages")
    .select("*")
    .eq("id", packageId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!pkg) {
    throw new ApiError("Implementation package not found.", 404, "NOT_FOUND");
  }

  const expectedStatuses = {
    approve_package: ["agency_review", "awaiting_agency_review"],
    publish_package: ["approved"],
    mark_implemented: ["client_approved"],
    verify_package: ["implemented", "implemented_unverified"],
  }[action];
  if (!expectedStatuses.includes(pkg.status)) {
    throw new ApiError(
      `This package cannot move from ${pkg.status} using ${action.replaceAll("_", " ")}.`,
      409,
      "CONFLICT",
    );
  }

  const status = {
    approve_package: "approved",
    publish_package: "awaiting_client",
    mark_implemented: "implemented_unverified",
    verify_package: "verified",
  }[action];
  const title =
    action === "approve_package"
      ? "Agency approval completed"
      : action === "publish_package"
        ? "Client approval requested"
        : action === "mark_implemented"
          ? "Implementation reported"
          : "Implementation verified";

  if (action === "mark_implemented") {
    if (!details.liveUrl) {
      throw new ApiError(
        "A live implementation URL is required before verification.",
        400,
        "VALIDATION_ERROR",
      );
    }
    const verification = await db.from("implementation_verifications").upsert(
      {
        agency_id: agencyId,
        client_organization_id: pkg.client_organization_id,
        project_id: pkg.project_id,
        package_id: packageId,
        live_url: details.liveUrl,
        status: "pending",
        proof: details.proof ?? {},
      },
      { onConflict: "package_id" },
    );
    if (verification.error) {
      throw new ApiError(
        "Implementation proof could not be stored.",
        500,
        "OPERATION_FAILED",
      );
    }
  }

  if (action === "verify_package") {
    const pending = await db
      .from("implementation_verifications")
      .select("id,live_url,proof")
      .eq("package_id", packageId)
      .eq("status", "pending")
      .maybeSingle();
    if (!pending.data) {
      throw new ApiError(
        "Record implementation proof before verification.",
        409,
        "CONFLICT",
      );
    }
    const automated = await verifyLiveImplementation({
      liveUrl: pending.data.live_url,
      packageData: pkg.package_data,
    });
    if (!automated.passed) {
      await db
        .from("implementation_verifications")
        .update({
          checks: automated.checks,
          error_details: { failed: automated.failed, page: automated.page },
          updated_at: nowIso(),
        })
        .eq("id", pending.data.id);
      throw new ApiError(
        `Automated live verification failed: ${automated.failed.join(", ")}.`,
        409,
        "WEBSITE_VERIFICATION_FAILED",
      );
    }
    const verification = await db
      .from("implementation_verifications")
      .update({
        status: "passed",
        checks: automated.checks,
        proof: {
          ...(pending.data.proof && typeof pending.data.proof === "object"
            ? pending.data.proof
            : {}),
          ...(details.proof ?? {}),
          automatedPage: automated.page,
        },
        error_details: {},
        verified_by: userId,
        verified_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", pending.data.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!verification.data) {
      throw new ApiError(
        "The implementation verification changed while checks were running.",
        409,
        "CONFLICT",
      );
    }
    const plan = await db.rpc("create_manual_monitoring_plan", {
      p_package_id: packageId,
      p_verified_by: userId,
    });
    if (plan.error) {
      await db
        .from("implementation_verifications")
        .update({ status: "pending", verified_by: null, verified_at: null })
        .eq("package_id", packageId)
        .eq("status", "passed");
      throw new ApiError(
        "Monitoring checkpoints could not be scheduled.",
        500,
        "OPERATION_FAILED",
      );
    }
  } else {
    const packagePatch: Record<string, unknown> = {
      status,
      updated_at: nowIso(),
    };
    if (action === "approve_package") {
      packagePatch.approved_by = userId;
      packagePatch.approved_at = nowIso();
    }
    if (action === "mark_implemented") packagePatch.implemented_at = nowIso();
    const updated = await db
      .from("implementation_packages")
      .update(packagePatch)
      .eq("id", packageId)
      .in("status", expectedStatuses)
      .select("id")
      .maybeSingle();
    if (!updated.data) {
      throw new ApiError(
        "The package changed while this action was being processed.",
        409,
        "CONFLICT",
      );
    }
  }

  if (action === "publish_package") {
    const packageData = asRecord(pkg.package_data);
    const publication = await db.from("client_portal_publications").upsert(
      {
        agency_id: agencyId,
        client_organization_id: pkg.client_organization_id,
        project_id: pkg.project_id,
        record_type: "implementation_package",
        source_id: packageId,
        title: (packageData.title as string) || "SEO implementation approval",
        summary:
          "Review the proposed SEO implementation, its evidence, and acceptance checks.",
        status: "awaiting_client",
        payload: {
          implementationPath: pkg.implementation_path,
          metadata: packageData.metadata ?? {},
          acceptanceCriteria: packageData.acceptanceCriteria ?? [],
          verificationChecklist: packageData.verificationChecklist ?? [],
        },
        published_by: userId,
        published_at: nowIso(),
        revoked_at: null,
      },
      { onConflict: "project_id,record_type,source_id" },
    );
    if (publication.error) {
      await db
        .from("implementation_packages")
        .update({ status: "approved", updated_at: nowIso() })
        .eq("id", packageId)
        .eq("status", status);
      throw new ApiError(
        "The package could not be published to the client portal.",
        500,
        "OPERATION_FAILED",
      );
    }
  } else if (action !== "approve_package") {
    await db
      .from("client_portal_publications")
      .update({ status })
      .eq("project_id", pkg.project_id)
      .eq("record_type", "implementation_package")
      .eq("source_id", packageId)
      .is("revoked_at", null);
  }

  if (action === "verify_package") {
    await db
      .from("seo_campaign_jobs")
      .update({
        status: "completed",
        progress_percent: 100,
        completed_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("agency_id", agencyId)
      .eq("project_id", pkg.project_id)
      .eq("status", "awaiting_manual_completion")
      .contains("result", { packageId });
    await db
      .from("seo_opportunities")
      .update({ status: "monitoring", updated_at: nowIso() })
      .eq("id", pkg.opportunity_id)
      .eq("agency_id", agencyId);
  }

  await recordEvent(db, {
    agencyId,
    clientOrganizationId: pkg.client_organization_id,
    projectId: pkg.project_id,
    eventType: action,
    title,
    description:
      action === "verify_package"
        ? "Verification passed and 7/14/30/60/90-day monitoring was scheduled."
        : "Workflow status updated.",
    actorUserId: userId,
    actorEmail: email,
    clientVisible: true,
  });
  await recordAudit(db, {
    agencyId,
    actorUserId: userId,
    action: `implementation_package.${action}`,
    resourceType: "implementation_package",
    resourceId: packageId,
    afterState: { status },
  });
}

export async function publishPackageToCms(email: string, packageId: string) {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "execution.approve");
  const pkg = await db
    .from("implementation_packages")
    .select("project_id,version")
    .eq("id", packageId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!pkg.data)
    throw new ApiError("Implementation package not found.", 404, "NOT_FOUND");
  return publishCmsPackage(db, {
    packageId,
    agencyId,
    projectId: pkg.data.project_id,
    actorId: userId,
    idempotencyKey: `cms:${packageId}:v${pkg.data.version ?? 1}`,
  });
}

export async function rollbackPackageCmsPublication(
  email: string,
  packageId: string,
  publicationId: string,
) {
  const { db, agencyId, userId, role } = await agencyContext(email);
  requireLivePermission(role, "deploy.rollback");
  const pkg = await db
    .from("implementation_packages")
    .select("project_id")
    .eq("id", packageId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!pkg.data)
    throw new ApiError("Implementation package not found.", 404, "NOT_FOUND");
  return rollbackCmsPublication(db, {
    publicationId,
    agencyId,
    projectId: pkg.data.project_id,
    actorId: userId,
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
    .select("id,role")
    .eq("user_id", userId)
    .eq("client_organization_id", pkg.client_organization_id)
    .eq("status", "active")
    .maybeSingle();
  if (!member) {
    throw new ApiError("Client approval access denied.", 403, "TENANT_DENIED");
  }
  if (!["client_admin", "client_approver"].includes(member.role)) {
    throw new ApiError(
      "This client role cannot make approval decisions.",
      403,
      "ROLE_FORBIDDEN",
    );
  }
  if (!["client_review", "awaiting_client"].includes(pkg.status)) {
    throw new ApiError(
      "This approval request has already been decided.",
      409,
      "CONFLICT",
    );
  }

  const approved=input.decision==="client_approved",approvalDigest=approved?implementationPackageDigest(pkg):null,approvedSnapshot=approved?implementationPackageSnapshot(pkg):{};
  const decided=await db.rpc("decide_implementation_package",{p_agency_id:pkg.agency_id,p_client_organization_id:pkg.client_organization_id,p_project_id:pkg.project_id,p_package_id:input.packageId,p_user_id:userId,p_decision:input.decision,p_note:"The client decision was recorded through the secure portal.",p_approval_digest:approvalDigest,p_approved_snapshot:approvedSnapshot});
  if(decided.error)throw new ApiError("This exact approval could not be committed or was already processed.",409,"CONFLICT");
  await recordAudit(db, {
    agencyId: pkg.agency_id,
    actorUserId: userId,
    action: "implementation_package.client_decision",
    resourceType: "implementation_package",
    resourceId: input.packageId,
    afterState: { decision: input.decision, clientRole: member.role, approvalDigest },
  });
}
