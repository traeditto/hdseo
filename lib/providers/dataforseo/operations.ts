import "server-only";
import type { ProviderOperation } from "./types";

export const providerOperations: Record<ProviderOperation, { endpoint: string; estimateUnitCost: number; payload: (input: { keywords?: string[]; target?: string; limit: number; locationName: string; languageCode: string }) => unknown[] }> = {
  keyword_overview: { endpoint: "/dataforseo_labs/google/keyword_overview/live", estimateUnitCost: .001, payload: (input) => [{ keywords: input.keywords, location_name: input.locationName, language_code: input.languageCode, include_serp_info: true }] },
  keyword_discovery: { endpoint: "/dataforseo_labs/google/keywords_for_site/live", estimateUnitCost: .02, payload: (input) => [{ target: input.target, location_name: input.locationName, language_code: input.languageCode, include_serp_info: true, include_subdomains: true, filters: ["keyword_info.search_volume", ">", 0], order_by: ["relevance,desc"], limit: input.limit }] },
  ranked_keywords: { endpoint: "/dataforseo_labs/google/ranked_keywords/live", estimateUnitCost: .02, payload: (input) => [{ target: input.target, location_name: input.locationName, language_code: input.languageCode, limit: input.limit }] },
  competitor_discovery: { endpoint: "/dataforseo_labs/google/competitors_domain/live", estimateUnitCost: .02, payload: (input) => [{ target: input.target, location_name: input.locationName, language_code: input.languageCode, limit: input.limit }] },
  relevant_pages: { endpoint: "/dataforseo_labs/google/relevant_pages/live", estimateUnitCost: .02, payload: (input) => [{ target: input.target, location_name: input.locationName, language_code: input.languageCode, limit: input.limit }] },
};
