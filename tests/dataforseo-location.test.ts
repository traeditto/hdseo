import { describe, expect, it } from "vitest";
import { buildDataForSeoPayload } from "../lib/providers/dataforseo/operation-payloads";
import { selectLabsLocation } from "../lib/providers/dataforseo/location-catalog";

describe("DataForSEO Labs location payloads", () => {
  it("uses the supported country location code instead of a service-area name", () => {
    const input = {
      target: "kingdomroofingco.com",
      limit: 50,
      locationCode: 2840,
      languageCode: "en",
    };
    for (const operation of ["keyword_discovery", "ranked_keywords"] as const) {
      const [payload] = buildDataForSeoPayload(operation, input) as Array<Record<string, unknown>>;
      expect(payload.location_code).toBe(2840);
      expect(payload).not.toHaveProperty("location_name");
    }
  });

  it("resolves the provider country independently from the client's service area", () => {
    const match = selectLabsLocation([{
      location_code: 2840,
      location_name: "United States",
      country_iso_code: "US",
      location_type: "Country",
      available_languages: [{ language_code: "en", available_sources: ["google"] }],
    }], "US", "en");
    expect(match?.location_code).toBe(2840);
    expect(match?.location_name).not.toBe("Jacksonville, Florida");
  });
});
