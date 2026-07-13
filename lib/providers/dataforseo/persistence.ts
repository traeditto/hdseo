import "server-only";
import type { PaidRunContext } from "@/lib/providers/paid-operation";
import type { ProviderOperation } from "./types";

const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const normalized = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

type ProviderItem = Record<string, unknown>;
function itemsFrom(results: unknown[]): ProviderItem[] {
  const output: ProviderItem[] = [];
  for (const result of results) {
    const record = result && typeof result === "object" ? result as ProviderItem : {};
    if (Array.isArray(record.items)) for (const item of record.items) if (item && typeof item === "object") output.push(item as ProviderItem);
  }
  return output;
}

export async function persistProviderResults(operation: ProviderOperation, context: PaidRunContext, results: unknown[]) {
  const items = itemsFrom(results);
  if (!items.length) return { table: null, rowsWritten: 0 };
  if (operation === "keyword_overview") {
    const keywords = await context.db.from("seo_keywords").select("id,normalized_keyword").eq("project_id", context.projectId);
    const keywordMap = new Map((keywords.data ?? []).map((row) => [row.normalized_keyword, row.id]));
    const rows = items.map((outer) => {
      const item = outer.keyword_data && typeof outer.keyword_data === "object" ? outer.keyword_data as ProviderItem : outer;
      const info = item.keyword_info && typeof item.keyword_info === "object" ? item.keyword_info as ProviderItem : {};
      const props = item.keyword_properties && typeof item.keyword_properties === "object" ? item.keyword_properties as ProviderItem : {};
      const intent = item.search_intent_info && typeof item.search_intent_info === "object" ? item.search_intent_info as ProviderItem : {};
      return { agency_id: context.agencyId, client_organization_id: context.clientId, project_id: context.projectId, keyword_id: keywordMap.get(normalized(item.keyword)) ?? null, keyword: String(item.keyword ?? ""), search_volume: numeric(info.search_volume), cpc: numeric(info.cpc), paid_competition: numeric(info.competition), competition_level: info.competition_level ?? null, keyword_difficulty: numeric(props.keyword_difficulty), search_intent: intent.main_intent ?? null, serp_features: [], source: "dataforseo", raw_response: item };
    }).filter((row) => row.keyword);
    const result = await context.db.from("keyword_metric_snapshots").insert(rows); if (result.error) throw result.error;
    return { table: "keyword_metric_snapshots", rowsWritten: rows.length };
  }
  if (operation === "ranked_keywords") {
    const keywords = await context.db.from("seo_keywords").select("id,normalized_keyword").eq("project_id", context.projectId);
    const keywordMap = new Map((keywords.data ?? []).map((row) => [row.normalized_keyword, row.id]));
    const rows = items.map((item) => {
      const keywordData = item.keyword_data && typeof item.keyword_data === "object" ? item.keyword_data as ProviderItem : {};
      const element = item.ranked_serp_element && typeof item.ranked_serp_element === "object" ? item.ranked_serp_element as ProviderItem : {};
      const serp = element.serp_item && typeof element.serp_item === "object" ? element.serp_item as ProviderItem : {};
      return { agency_id: context.agencyId, client_organization_id: context.clientId, project_id: context.projectId, keyword_id: keywordMap.get(normalized(keywordData.keyword)) ?? null, position: numeric(serp.rank_absolute), ranking_url: serp.url ?? null, search_engine: "google", device: "desktop", location_code: null, collected_at: new Date().toISOString() };
    }).filter((row) => row.keyword_id);
    const result = await context.db.from("organic_ranking_snapshots").insert(rows); if (result.error) throw result.error;
    return { table: "organic_ranking_snapshots", rowsWritten: rows.length };
  }
  if (operation === "competitor_discovery") {
    const rows = items.filter((item) => typeof item.domain === "string").map((item) => ({ agency_id: context.agencyId, client_organization_id: context.clientId, project_id: context.projectId, domain: item.domain, display_name: item.domain, intersections: numeric(item.intersections), average_position: numeric(item.avg_position), estimated_traffic: null, raw_response: item, last_seen_at: new Date().toISOString() }));
    const result = await context.db.from("competitor_domains").upsert(rows, { onConflict: "project_id,domain" }); if (result.error) throw result.error;
    return { table: "competitor_domains", rowsWritten: rows.length };
  }
  const rows = items.map((item) => ({ agency_id: context.agencyId, client_organization_id: context.clientId, project_id: context.projectId, url: String(item.page_address ?? ""), source_files: [], headings: [], internal_links: [], schema_types: [], assigned_keywords: [], source_commit_sha: `dataforseo:${Date.now()}` })).filter((row) => row.url);
  const result = await context.db.from("seo_page_snapshots").insert(rows); if (result.error) throw result.error;
  return { table: "seo_page_snapshots", rowsWritten: rows.length };
}
