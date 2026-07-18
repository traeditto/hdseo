import type { ProviderOperation } from "./types";

export type DataForSeoOperationInput = {
  keywords?: string[];
  target?: string;
  limit: number;
  locationCode: number;
  languageCode: string;
};

export function buildDataForSeoPayload(
  operation: ProviderOperation,
  input: DataForSeoOperationInput,
): unknown[] {
  const location = {
    location_code: input.locationCode,
    language_code: input.languageCode,
  };
  if (operation === "keyword_overview") {
    return [{ ...location, keywords: input.keywords, include_serp_info: true }];
  }
  if (operation === "keyword_discovery") {
    return [{
      ...location,
      target: input.target,
      include_serp_info: true,
      include_subdomains: true,
      filters: ["keyword_info.search_volume", ">", 0],
      order_by: ["relevance,desc"],
      limit: input.limit,
    }];
  }
  return [{ ...location, target: input.target, limit: input.limit }];
}
