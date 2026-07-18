import "server-only";

import { ApiError } from "@/lib/api/errors";
import { dataForSeoGet } from "./client";
import { selectLabsLocation, type LabsLocation } from "./location-catalog";

export type ResolvedLabsLocation = {
  countryCode: string;
  locationCode: number;
  locationName: string;
  languageCode: string;
};

let cachedLocations: { expiresAt: number; rows: LabsLocation[] } | null = null;

async function labsLocations() {
  if (cachedLocations && cachedLocations.expiresAt > Date.now()) return cachedLocations.rows;
  const response = await dataForSeoGet<LabsLocation>(
    "/dataforseo_labs/locations_and_languages",
    "labs-location-catalog",
  );
  cachedLocations = { rows: response.results, expiresAt: Date.now() + 24 * 60 * 60_000 };
  return response.results;
}

export async function resolveLabsLocation(
  countryCode = "US",
  languageCode = "en",
): Promise<ResolvedLabsLocation> {
  const country = countryCode.trim().toUpperCase() || "US";
  const language = languageCode.trim().toLowerCase() || "en";
  const rows = await labsLocations();
  const match = selectLabsLocation(rows, country, language);
  if (!match?.location_code || !match.location_name) {
    throw new ApiError(
      `DataForSEO does not support Google Labs data for ${country}/${language}.`,
      409,
      "NOT_CONFIGURED",
    );
  }
  return {
    countryCode: country,
    locationCode: match.location_code,
    locationName: match.location_name,
    languageCode: language,
  };
}
