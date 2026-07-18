export type LabsLanguage = {
  language_code?: string;
  available_sources?: string[];
};

export type LabsLocation = {
  location_code?: number;
  location_name?: string;
  country_iso_code?: string;
  location_type?: string;
  available_languages?: LabsLanguage[];
};

export function selectLabsLocation(
  rows: LabsLocation[],
  countryCode: string,
  languageCode: string,
) {
  const country = countryCode.trim().toUpperCase();
  const language = languageCode.trim().toLowerCase();
  return rows.find((row) =>
    row.country_iso_code?.toUpperCase() === country &&
    row.location_type === "Country" &&
    row.available_languages?.some((item) =>
      item.language_code?.toLowerCase() === language &&
      item.available_sources?.includes("google"),
    ),
  ) ?? null;
}
