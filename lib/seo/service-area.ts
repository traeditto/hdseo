export type ServiceArea = {
  id?: string | null;
  name: string;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  priority?: number | null;
};

export type ServiceDefinition = {
  id?: string | null;
  name: string;
  priority?: number | null;
};

export type ServiceAreaPolicy = {
  targetMarket: string;
  serviceAreas: ServiceArea[];
  services: ServiceDefinition[];
  local: boolean;
};

export type ServiceAreaAssessment = {
  allowed: boolean;
  locationRelevance: number;
  serviceRelevance: number;
  locationId: string | null;
  serviceId: string | null;
  reasonCodes: string[];
};

const broadMarkets = new Set([
  "united states",
  "united states of america",
  "usa",
  "us",
  "nationwide",
  "national",
  "all locations",
]);

const stateNames = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
  "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming", "district of columbia",
];

// Used only to detect an explicit out-of-area modifier. Generic searches remain
// eligible because their demand and rankings are collected in the target market.
const commonUsCities = [
  "new york", "los angeles", "chicago", "houston", "phoenix", "philadelphia",
  "san antonio", "san diego", "dallas", "san jose", "austin", "jacksonville",
  "fort worth", "columbus", "indianapolis", "charlotte", "seattle", "denver",
  "washington dc", "nashville", "oklahoma city", "el paso", "boston",
  "portland", "las vegas", "detroit", "memphis", "louisville", "baltimore",
  "milwaukee", "albuquerque", "tucson", "fresno", "sacramento", "mesa",
  "kansas city", "atlanta", "omaha", "colorado springs", "raleigh",
  "long beach", "virginia beach", "miami", "oakland", "minneapolis",
  "tulsa", "bakersfield", "wichita", "arlington", "aurora", "tampa",
  "new orleans", "cleveland", "honolulu", "anaheim", "lexington",
  "stockton", "corpus christi", "henderson", "riverside", "newark",
  "saint paul", "st paul", "santa ana", "cincinnati", "orlando",
  "pittsburgh", "st louis", "saint louis", "greensboro", "jersey city",
  "durham", "lincoln", "plano", "anchorage", "irvine", "chandler",
  "chula vista", "buffalo", "gilbert", "reno", "madison", "fort wayne",
  "north las vegas", "st petersburg", "saint petersburg", "lubbock",
  "toledo", "laredo", "glendale", "scottsdale", "winston salem",
  "chesapeake", "norfolk", "fremont", "garland", "boise", "richmond",
  "baton rouge", "spokane", "des moines", "tacoma", "san bernardino",
  "modesto", "fontana", "moreno valley", "fayetteville", "yonkers",
  "rochester", "montgomery", "little rock", "akron", "augusta",
  "grand rapids", "salt lake city", "tallahassee", "huntsville",
  "knoxville", "worcester", "newport news", "brownsville", "overland park",
  "santa clarita", "providence", "garden grove", "chattanooga", "oceanside",
  "fort lauderdale", "cape coral", "gainesville", "ocala", "lakeland",
  "pensacola", "daytona beach", "palm bay", "port st lucie",
  "st augustine", "saint augustine", "orange park",
];

export function normalizeGeography(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(text: string, phrase: string) {
  const normalized = normalizeGeography(phrase);
  if (!normalized) return false;
  return ` ${text} `.includes(` ${normalized} `);
}

function areaPhrases(area: ServiceArea) {
  return [...new Set([
    area.name,
    area.city,
    area.county,
    area.state,
    area.postalCode,
  ].filter((value): value is string => Boolean(value?.trim())).map(normalizeGeography))];
}

function specificMarket(value?: string | null) {
  const normalized = normalizeGeography(value ?? "");
  return normalized && !broadMarkets.has(normalized) ? value!.trim() : null;
}

export function buildServiceAreaPolicy(input: {
  primaryMarket?: string | null;
  requestedMarket?: string | null;
  serviceAreas?: ServiceArea[];
  services?: ServiceDefinition[];
}): ServiceAreaPolicy {
  const serviceAreas = [...(input.serviceAreas ?? [])].sort(
    (a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0),
  );
  const services = [...(input.services ?? [])].sort(
    (a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0),
  );
  const configuredPhrases = new Set(serviceAreas.flatMap(areaPhrases));
  const requested = specificMarket(input.requestedMarket);
  const primary = specificMarket(input.primaryMarket);
  const requestedIsConfigured = requested
    ? [...configuredPhrases].some((phrase) =>
        containsPhrase(normalizeGeography(requested), phrase),
      )
    : false;
  const targetMarket = serviceAreas.length
    ? requestedIsConfigured
      ? requested!
      : primary && [...configuredPhrases].some((phrase) =>
          containsPhrase(normalizeGeography(primary), phrase),
        )
        ? primary
        : serviceAreas[0].name
    : primary ?? requested ?? input.primaryMarket?.trim() ?? input.requestedMarket?.trim() ?? "United States";
  return { targetMarket, serviceAreas, services, local: serviceAreas.length > 0 };
}

export function assessKeywordServiceArea(
  keyword: string,
  policy: ServiceAreaPolicy,
): ServiceAreaAssessment {
  const normalized = normalizeGeography(keyword);
  const matchedArea = policy.serviceAreas.find((area) =>
    areaPhrases(area).some((phrase) => containsPhrase(normalized, phrase)),
  );
  const matchedService = policy.services.find((service) =>
    containsPhrase(normalized, service.name),
  );

  if (!policy.local) {
    return {
      allowed: true,
      locationRelevance: 70,
      serviceRelevance: matchedService ? 95 : policy.services.length ? 60 : 70,
      locationId: null,
      serviceId: matchedService?.id ?? null,
      reasonCodes: ["MARKET_SCOPED"],
    };
  }

  if (matchedArea) {
    return {
      allowed: true,
      locationRelevance: 100,
      serviceRelevance: matchedService ? 100 : policy.services.length ? 65 : 75,
      locationId: matchedArea.id ?? null,
      serviceId: matchedService?.id ?? null,
      reasonCodes: ["SERVICE_AREA_MATCH"],
    };
  }

  const explicitState = stateNames.find((state) => containsPhrase(normalized, state));
  const explicitCity = commonUsCities.find((city) => containsPhrase(normalized, city));
  const explicitPostalCode = /\b\d{5}(?:-\d{4})?\b/.test(keyword);
  if (explicitState || explicitCity || explicitPostalCode) {
    return {
      allowed: false,
      locationRelevance: 0,
      serviceRelevance: matchedService ? 95 : policy.services.length ? 55 : 70,
      locationId: null,
      serviceId: matchedService?.id ?? null,
      reasonCodes: ["OUTSIDE_SERVICE_AREA"],
    };
  }

  return {
    allowed: true,
    locationRelevance: 82,
    serviceRelevance: matchedService ? 95 : policy.services.length ? 60 : 70,
    locationId: null,
    serviceId: matchedService?.id ?? null,
    reasonCodes: ["TARGET_MARKET_SCOPED"],
  };
}
