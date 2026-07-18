import "server-only";
import type { ProviderOperation } from "./types";
import { buildDataForSeoPayload, type DataForSeoOperationInput } from "./operation-payloads";

export const providerOperations: Record<ProviderOperation, { endpoint: string; estimateUnitCost: number; payload: (input: DataForSeoOperationInput) => unknown[] }> = {
  keyword_overview: { endpoint: "/dataforseo_labs/google/keyword_overview/live", estimateUnitCost: .001, payload: (input) => buildDataForSeoPayload("keyword_overview", input) },
  keyword_discovery: { endpoint: "/dataforseo_labs/google/keywords_for_site/live", estimateUnitCost: .02, payload: (input) => buildDataForSeoPayload("keyword_discovery", input) },
  ranked_keywords: { endpoint: "/dataforseo_labs/google/ranked_keywords/live", estimateUnitCost: .02, payload: (input) => buildDataForSeoPayload("ranked_keywords", input) },
  competitor_discovery: { endpoint: "/dataforseo_labs/google/competitors_domain/live", estimateUnitCost: .02, payload: (input) => buildDataForSeoPayload("competitor_discovery", input) },
  relevant_pages: { endpoint: "/dataforseo_labs/google/relevant_pages/live", estimateUnitCost: .02, payload: (input) => buildDataForSeoPayload("relevant_pages", input) },
};
