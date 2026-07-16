export type SiteType =
  | "local_service"
  | "ecommerce"
  | "saas"
  | "publisher"
  | "agency"
  | "other";

export interface ClassificationPage {
  url: string;
  title?: string | null;
  h1?: string | null;
  schemaTypes?: string[];
}

export interface SiteClassificationInput {
  industry?: string | null;
  countryCode?: string | null;
  languageCode?: string | null;
  serviceCount: number;
  locationCount: number;
  pages: ClassificationPage[];
}

export interface SiteClassification {
  primaryType: SiteType;
  confidence: number;
  secondaryTypes: SiteType[];
  scores: Record<SiteType, number>;
  signals: string[];
  international: boolean;
}

const siteTypes: SiteType[] = [
  "local_service",
  "ecommerce",
  "saas",
  "publisher",
  "agency",
  "other",
];

const clamp = (value: number) => Math.min(100, Math.max(0, value));

export function classifySite(input: SiteClassificationInput): SiteClassification {
  const scores: Record<SiteType, number> = {
    local_service: 0,
    ecommerce: 0,
    saas: 0,
    publisher: 0,
    agency: 0,
    other: 10,
  };
  const signals: string[] = [];
  const industry = (input.industry ?? "").toLowerCase();
  const pageText = input.pages
    .map((page) => `${page.url} ${page.title ?? ""} ${page.h1 ?? ""}`)
    .join(" ")
    .toLowerCase();
  const schemas = new Set(
    input.pages.flatMap((page) => page.schemaTypes ?? []).map((type) => type.toLowerCase()),
  );

  if (input.locationCount > 0) {
    scores.local_service += Math.min(45, 25 + input.locationCount * 4);
    signals.push(`${input.locationCount} configured service location(s)`);
  }
  if (input.serviceCount > 0) {
    scores.local_service += Math.min(25, 8 + input.serviceCount * 2);
    scores.agency += Math.min(18, input.serviceCount * 2);
    signals.push(`${input.serviceCount} configured service(s)`);
  }
  if ([...schemas].some((type) => type.includes("localbusiness"))) {
    scores.local_service += 35;
    signals.push("LocalBusiness structured data");
  }
  if (/\b(serving|service area|near me|directions|our locations?)\b/.test(pageText)) {
    scores.local_service += 18;
    signals.push("service-area language");
  }

  if ([...schemas].some((type) => /product|offer|aggregateoffer/.test(type))) {
    scores.ecommerce += 50;
    signals.push("product or offer structured data");
  }
  if (/\/(products?|collections?|shop|cart|checkout)(\/|\b)/.test(pageText)) {
    scores.ecommerce += 35;
    signals.push("commerce URL structure");
  }

  if ([...schemas].some((type) => /softwareapplication|webapplication/.test(type))) {
    scores.saas += 45;
    signals.push("software application structured data");
  }
  if (/\/(pricing|docs|integrations|features|signup|login)(\/|\b)/.test(pageText)) {
    scores.saas += 30;
    signals.push("software product URL structure");
  }

  if ([...schemas].some((type) => /article|newsarticle|blogposting/.test(type))) {
    scores.publisher += 45;
    signals.push("article structured data");
  }
  const editorialPages = input.pages.filter((page) =>
    /\/(blog|news|guides?|articles?|resources?)(\/|$)/i.test(page.url),
  ).length;
  if (editorialPages >= 3) {
    scores.publisher += Math.min(40, 15 + editorialPages * 2);
    signals.push(`${editorialPages} editorial pages`);
  }

  if (/agency|marketing|consulting|studio/.test(industry)) {
    scores.agency += 45;
    signals.push("agency-oriented industry");
  }
  if (/\/(work|portfolio|case-studies|clients)(\/|\b)/.test(pageText)) {
    scores.agency += 25;
    signals.push("agency portfolio URL structure");
  }

  for (const type of siteTypes) scores[type] = clamp(scores[type]);
  const ordered = siteTypes
    .filter((type) => type !== "other")
    .sort((a, b) => scores[b] - scores[a]);
  const primaryType = scores[ordered[0]] >= 20 ? ordered[0] : "other";
  const secondaryTypes = ordered.filter(
    (type) => type !== primaryType && scores[type] >= 35,
  );
  const international =
    (input.countryCode ?? "US").toUpperCase() !== "US" ||
    !["en", "en-us"].includes((input.languageCode ?? "en").toLowerCase()) ||
    input.pages.some((page) => /\/(en|es|fr|de|it|pt|ja|ko|zh)(-|\/)/i.test(page.url));
  if (international) signals.push("international or multilingual targeting");

  return {
    primaryType,
    confidence: primaryType === "other" ? 35 : clamp(45 + scores[primaryType] / 2),
    secondaryTypes,
    scores,
    signals: [...new Set(signals)],
    international,
  };
}
