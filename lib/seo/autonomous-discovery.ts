import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
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
} from "./keyword-discovery";
import {
  discoverSearchConsoleCandidates,
  type SearchConsoleEvidenceRow,
} from "./search-console-discovery";
import { assessKeywordServiceArea } from "./service-area";
import {
  loadProjectServiceAreaPolicy,
  quarantineOutOfAreaKeywords,
} from "./service-area-server";

export interface DiscoveryTenant {
  agencyId: string;
  clientId: string;
  projectId: string;
  requestedBy: string;
}

export interface DomainDiscoveryInput extends DiscoveryTenant {
  confirmationId: string;
  domain: string;
  targetMarket: string;
  languageCode: string;
  monthlyBudget: number;
  limit: number;
}

export function domainDiscoveryScope(input: {
  domain: string;
  targetMarket: string;
  languageCode: string;
  limit: number;
}) {
  return {
    operation: "keyword_discovery" as const,
    sources: ["keywords_for_site", "ranked_keywords"],
    keywords: null,
    target: input.domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .toLowerCase(),
    limit: input.limit,
    locationName: input.targetMarket,
    languageCode: input.languageCode,
  };
}

export function estimatedDomainDiscoveryCost(limit: number) {
  return Number(
    (
      (providerOperations.keyword_discovery.estimateUnitCost +
        providerOperations.ranked_keywords.estimateUnitCost) *
      limit
    ).toFixed(4),
  );
}

async function existingKeywordIds(db: SupabaseClient, projectId: string) {
  const result = await db
    .from("seo_keywords")
    .select("id,normalized_keyword")
    .eq("project_id", projectId);
  if (result.error) throw result.error;
  return new Map(
    (result.data ?? []).map((row) => [row.normalized_keyword, row.id as string]),
  );
}

async function persistProviderCandidates(
  db: SupabaseClient,
  tenant: DiscoveryTenant,
  candidates: ReturnType<typeof discoverKeywordCandidates>,
  targetMarket: string,
) {
  const ids = await existingKeywordIds(db, tenant.projectId);
  const missing = candidates
    .filter((candidate) => !ids.has(candidate.normalizedKeyword))
    .map((candidate) => ({
      agency_id: tenant.agencyId,
      client_organization_id: tenant.clientId,
      project_id: tenant.projectId,
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
  if (missing.length) {
    const inserted = await db
      .from("seo_keywords")
      .insert(missing)
      .select("id,normalized_keyword");
    if (inserted.error) throw inserted.error;
    for (const row of inserted.data ?? []) ids.set(row.normalized_keyword, row.id);
  }

  const capturedAt = new Date().toISOString();
  const metrics = candidates.flatMap((candidate) => {
    const keywordId = ids.get(candidate.normalizedKeyword);
    return keywordId
      ? [{
          agency_id: tenant.agencyId,
          client_organization_id: tenant.clientId,
          project_id: tenant.projectId,
          keyword_id: keywordId,
          keyword: candidate.keyword,
          search_volume: candidate.searchVolume,
          cpc: candidate.cpc,
          keyword_difficulty: candidate.difficulty,
          search_intent: candidate.intent,
          source: "dataforseo_domain_discovery",
          raw_response: {
            estimatedMonthlyValue: candidate.estimatedMonthlyValue,
            estimatedEffort: candidate.estimatedEffort,
            valuePerDollar: candidate.valuePerDollar,
          },
          captured_at: capturedAt,
        }]
      : [];
  });
  const rankings = candidates.flatMap((candidate) => {
    const keywordId = ids.get(candidate.normalizedKeyword);
    return keywordId && candidate.currentRank != null
      ? [{
          agency_id: tenant.agencyId,
          client_organization_id: tenant.clientId,
          project_id: tenant.projectId,
          keyword_id: keywordId,
          position: candidate.currentRank,
          ranking_url: candidate.rankingUrl,
          search_engine: "google",
          device: "desktop",
          location_code: targetMarket,
          collected_at: capturedAt,
        }]
      : [];
  });
  if (metrics.length) {
    const written = await db.from("keyword_metric_snapshots").insert(metrics);
    if (written.error) throw written.error;
  }
  if (rankings.length) {
    const written = await db.from("organic_ranking_snapshots").insert(rankings);
    if (written.error) throw written.error;
  }
  await db
    .from("seo_projects")
    .update({
      data_readiness_status: candidates.length ? "ready" : "needs_data",
      updated_at: capturedAt,
    })
    .eq("id", tenant.projectId);
  return { keywords: candidates.length, metrics: metrics.length, rankings: rankings.length };
}

export async function importSearchConsoleDiscovery(
  db: SupabaseClient,
  tenant: DiscoveryTenant,
  limit = 100,
) {
  const policy = await loadProjectServiceAreaPolicy(db, tenant.projectId);
  await quarantineOutOfAreaKeywords(db, tenant.projectId, policy);
  const result = await db
    .from("search_console_rows")
    .select("query,page_url,clicks,impressions,ctr,average_position")
    .eq("project_id", tenant.projectId)
    .not("query", "is", null)
    .order("date", { ascending: false })
    .limit(10_000);
  if (result.error) throw result.error;
  const candidates = discoverSearchConsoleCandidates(
    (result.data ?? []) as SearchConsoleEvidenceRow[],
    limit,
  ).flatMap((candidate) => {
    const assessment = assessKeywordServiceArea(candidate.keyword, policy);
    return assessment.allowed ? [{ ...candidate, assessment }] : [];
  });
  if (!candidates.length) return { source: "google_search_console", keywords: 0, metrics: 0, rankings: 0 };

  const ids = await existingKeywordIds(db, tenant.projectId);
  const missing = candidates
    .filter((candidate) => !ids.has(candidate.normalizedKeyword))
    .map((candidate) => ({
      agency_id: tenant.agencyId,
      client_organization_id: tenant.clientId,
      project_id: tenant.projectId,
      service_id: candidate.assessment.serviceId,
      location_id: candidate.assessment.locationId,
      keyword: candidate.keyword,
      normalized_keyword: candidate.normalizedKeyword,
      intent: candidate.intent,
      commercial_intent_score: candidate.commercialIntentScore,
      target_url: candidate.rankingUrl,
      priority: candidate.priority,
      status: "active",
    }));
  if (missing.length) {
    const inserted = await db
      .from("seo_keywords")
      .insert(missing)
      .select("id,normalized_keyword");
    if (inserted.error) throw inserted.error;
    for (const row of inserted.data ?? []) ids.set(row.normalized_keyword, row.id);
  }

  const capturedAt = new Date().toISOString();
  const metrics = candidates.flatMap((candidate) => {
    const keywordId = ids.get(candidate.normalizedKeyword);
    return keywordId
      ? [{
          agency_id: tenant.agencyId,
          client_organization_id: tenant.clientId,
          project_id: tenant.projectId,
          keyword_id: keywordId,
          keyword: candidate.keyword,
          search_volume: null,
          cpc: null,
          keyword_difficulty: null,
          search_intent: candidate.intent,
          source: "google_search_console",
          raw_response: {
            clicks: candidate.clicks,
            impressions: candidate.impressions,
            ctr: candidate.ctr,
            averagePosition: candidate.averagePosition,
            note: "Search Console impressions are first-party visibility, not search volume.",
            targetMarket: policy.targetMarket,
            serviceAreaReasonCodes: candidate.assessment.reasonCodes,
          },
          captured_at: capturedAt,
        }]
      : [];
  });
  const rankings = candidates.flatMap((candidate) => {
    const keywordId = ids.get(candidate.normalizedKeyword);
    return keywordId && candidate.averagePosition != null
      ? [{
          agency_id: tenant.agencyId,
          client_organization_id: tenant.clientId,
          project_id: tenant.projectId,
          keyword_id: keywordId,
          position: candidate.averagePosition,
          ranking_url: candidate.rankingUrl,
          search_engine: "google_search_console",
          device: "all",
          location_code: null,
          collected_at: capturedAt,
        }]
      : [];
  });
  if (metrics.length) {
    const written = await db.from("keyword_metric_snapshots").insert(metrics);
    if (written.error) throw written.error;
  }
  if (rankings.length) {
    const written = await db.from("organic_ranking_snapshots").insert(rankings);
    if (written.error) throw written.error;
  }
  await db
    .from("seo_projects")
    .update({ data_readiness_status: "ready", updated_at: capturedAt })
    .eq("id", tenant.projectId);
  return {
    source: "google_search_console",
    keywords: candidates.length,
    metrics: metrics.length,
    rankings: rankings.length,
  };
}

export async function runAuthorizedDomainDiscovery(
  db: SupabaseClient,
  input: DomainDiscoveryInput,
) {
  const policy = await loadProjectServiceAreaPolicy(
    db,
    input.projectId,
    input.targetMarket,
  );
  await quarantineOutOfAreaKeywords(db, input.projectId, policy);
  const effectiveInput = { ...input, targetMarket: policy.targetMarket };
  const scope = domainDiscoveryScope(effectiveInput);
  const estimatedCost = estimatedDomainDiscoveryCost(input.limit);
  let paid: Awaited<ReturnType<typeof beginPaidOperation>> | null = null;
  try {
    paid = await beginPaidOperation(
      {
        user: { id: input.requestedBy },
        agency: { id: input.agencyId },
        client: { id: input.clientId },
        project: { id: input.projectId },
      },
      {
        confirmationId: input.confirmationId,
        operation: "keyword_discovery",
        estimatedUnits: input.limit,
        estimatedCost,
        scopeHash: paidScopeHash(scope),
      },
    );
    const providerInput = {
      target: scope.target,
      limit: input.limit,
      locationName: policy.targetMarket,
      languageCode: input.languageCode,
    };
    const [site, ranked] = await Promise.all([
      dataForSeoRequest<unknown>(
        providerOperations.keyword_discovery.endpoint,
        providerOperations.keyword_discovery.payload(providerInput),
        `campaign-discovery:${paid.usageId}:site`,
      ),
      dataForSeoRequest<unknown>(
        providerOperations.ranked_keywords.endpoint,
        providerOperations.ranked_keywords.payload(providerInput),
        `campaign-discovery:${paid.usageId}:ranked`,
      ),
    ]);
    const results = [...site.results, ...ranked.results];
    const candidates = discoverKeywordCandidates(
      results,
      input.monthlyBudget,
      Math.min(100, input.limit),
      policy,
    );
    const persisted = await persistProviderCandidates(
      db,
      input,
      candidates,
      policy.targetMarket,
    );
    const cost = site.totalCost + ranked.totalCost;
    const analyzed = countDiscoveredKeywordRecords(results);
    await finishPaidOperation(paid, {
      cost,
      units: analyzed,
      status: "completed",
    });
    paid = null;
    return { source: "dataforseo_domain_discovery", analyzed, cost, ...persisted };
  } catch (error) {
    if (paid) {
      await finishPaidOperation(paid, {
        cost: 0,
        units: 0,
        status: "failed",
        error: error instanceof Error ? error.message : "Discovery failed",
      }).catch(() => undefined);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      `Automatic domain discovery failed: ${error instanceof Error ? error.message : "unknown error"}`,
      502,
      "OPERATION_FAILED",
    );
  }
}
