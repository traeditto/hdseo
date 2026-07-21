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
  marketScope: "service_area" | "nationwide";
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
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
  "district of columbia",
];

// Ambiguous English words such as "in", "or", "me", "ok", and "hi" are
// intentionally omitted. Matched service-area aliases are accepted before
// this out-of-market check runs.
const unambiguousStateCodes = new Set([
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "fl",
  "ga",
  "id",
  "il",
  "ia",
  "ks",
  "ky",
  "la",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wv",
  "wi",
  "wy",
  "dc",
]);

// Used only to detect an explicit out-of-area modifier. Generic searches remain
// eligible because their demand and rankings are collected in the target market.
const commonUsCities = [
  "new york",
  "los angeles",
  "chicago",
  "houston",
  "phoenix",
  "philadelphia",
  "san antonio",
  "san diego",
  "dallas",
  "san jose",
  "austin",
  "jacksonville",
  "fort worth",
  "columbus",
  "indianapolis",
  "charlotte",
  "seattle",
  "denver",
  "washington dc",
  "nashville",
  "oklahoma city",
  "el paso",
  "boston",
  "portland",
  "las vegas",
  "detroit",
  "memphis",
  "louisville",
  "baltimore",
  "milwaukee",
  "albuquerque",
  "tucson",
  "fresno",
  "sacramento",
  "mesa",
  "kansas city",
  "atlanta",
  "omaha",
  "colorado springs",
  "raleigh",
  "long beach",
  "virginia beach",
  "miami",
  "oakland",
  "minneapolis",
  "tulsa",
  "bakersfield",
  "wichita",
  "arlington",
  "aurora",
  "tampa",
  "new orleans",
  "cleveland",
  "honolulu",
  "anaheim",
  "lexington",
  "stockton",
  "corpus christi",
  "henderson",
  "riverside",
  "newark",
  "saint paul",
  "st paul",
  "santa ana",
  "cincinnati",
  "orlando",
  "pittsburgh",
  "st louis",
  "saint louis",
  "greensboro",
  "jersey city",
  "durham",
  "lincoln",
  "plano",
  "anchorage",
  "irvine",
  "chandler",
  "chula vista",
  "buffalo",
  "gilbert",
  "reno",
  "madison",
  "fort wayne",
  "north las vegas",
  "st petersburg",
  "saint petersburg",
  "lubbock",
  "toledo",
  "laredo",
  "glendale",
  "scottsdale",
  "winston salem",
  "chesapeake",
  "norfolk",
  "fremont",
  "garland",
  "boise",
  "richmond",
  "baton rouge",
  "spokane",
  "des moines",
  "tacoma",
  "san bernardino",
  "modesto",
  "fontana",
  "moreno valley",
  "fayetteville",
  "yonkers",
  "rochester",
  "montgomery",
  "little rock",
  "akron",
  "augusta",
  "grand rapids",
  "salt lake city",
  "tallahassee",
  "huntsville",
  "knoxville",
  "worcester",
  "newport news",
  "brownsville",
  "overland park",
  "santa clarita",
  "providence",
  "garden grove",
  "chattanooga",
  "oceanside",
  "fort lauderdale",
  "cape coral",
  "gainesville",
  "ocala",
  "lakeland",
  "pensacola",
  "daytona beach",
  "palm bay",
  "port st lucie",
  "st augustine",
  "saint augustine",
  "orange park",
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
  const values = [area.name, area.city, area.county, area.state, area.postalCode]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeGeography);
  return [
    ...new Set(
      values.flatMap((value) => {
        const withoutRegionSuffix = value
          .replace(/\s+(?:area|metro|metropolitan area|region|market)$/, "")
          .trim();
        const aliases =
          withoutRegionSuffix === "jacksonville"
            ? ["jax"]
            : withoutRegionSuffix === "new york"
              ? ["nyc"]
              : withoutRegionSuffix === "los angeles"
                ? ["la"]
                : [];
        return [
          value,
          ...(withoutRegionSuffix && withoutRegionSuffix !== value
            ? [withoutRegionSuffix]
            : []),
          ...aliases,
        ];
      }),
    ),
  ];
}

const serviceStopWords = new Set([
  "and",
  "service",
  "services",
  "company",
  "companies",
  "contractor",
  "contractors",
  "installation",
  "install",
  "installer",
  "installers",
  "repair",
  "repairs",
  "replacement",
  "replacements",
]);
const serviceRoot = (token: string) =>
  ["roofing", "roofer", "roofers", "roofs"].includes(token)
    ? "roof"
    : token === "gutters"
      ? "gutter"
      : token.replace(/s$/, "");
const serviceTokens = (value: string) =>
  normalizeGeography(value)
    .split(" ")
    .map(serviceRoot)
    .filter((token) => token && !serviceStopWords.has(token));
function matchesService(keyword: string, service: string) {
  if (containsPhrase(keyword, service)) return true;
  const keywordTokens = new Set(serviceTokens(keyword));
  const required = serviceTokens(service);
  return required.length > 0 && required.some((token) => keywordTokens.has(token));
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
  marketScope?: "service_area" | "nationwide" | null;
}): ServiceAreaPolicy {
  const serviceAreas = [...(input.serviceAreas ?? [])].sort(
    (a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0),
  );
  const services = [...(input.services ?? [])].sort(
    (a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0),
  );
  const configuredPhrases = new Set(serviceAreas.flatMap(areaPhrases));
  const marketScope =
    input.marketScope === "nationwide" ? "nationwide" : "service_area";
  if (marketScope === "nationwide") {
    const broadTarget = [input.requestedMarket, input.primaryMarket]
      .map((value) => value?.trim())
      .find((value) => value && broadMarkets.has(normalizeGeography(value)));
    return {
      targetMarket: broadTarget ?? "United States",
      serviceAreas,
      services,
      local: false,
      marketScope,
    };
  }
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
      : primary &&
          [...configuredPhrases].some((phrase) =>
            containsPhrase(normalizeGeography(primary), phrase),
          )
        ? primary
        : serviceAreas[0].name
    : (primary ??
      requested ??
      input.primaryMarket?.trim() ??
      input.requestedMarket?.trim() ??
      "United States");
  return {
    targetMarket,
    serviceAreas,
    services,
    local: serviceAreas.length > 0,
    marketScope,
  };
}

export function assessKeywordServiceArea(
  keyword: string,
  policy: ServiceAreaPolicy,
): ServiceAreaAssessment {
  const normalized = normalizeGeography(keyword);
  const matchedArea = policy.serviceAreas.find((area) =>
    areaPhrases(area).some((phrase) => containsPhrase(normalized, phrase)),
  );
  const matchedService =
    policy.services.find((service) => containsPhrase(normalized, service.name)) ??
    policy.services.find((service) => matchesService(normalized, service.name));

  if (!policy.local) {
    return {
      allowed: true,
      locationRelevance: 70,
      serviceRelevance: matchedService ? 95 : policy.services.length ? 60 : 70,
      locationId: null,
      serviceId: matchedService?.id ?? null,
      reasonCodes: [
        policy.marketScope === "nationwide"
          ? "NATIONWIDE_SCOPE"
          : "MARKET_SCOPED",
      ],
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

  const explicitState = stateNames.find((state) =>
    containsPhrase(normalized, state),
  );
  const explicitCity = commonUsCities.find((city) =>
    containsPhrase(normalized, city),
  );
  const explicitStateCode = normalized
    .split(" ")
    .find((token) => unambiguousStateCodes.has(token));
  const explicitPostalCode = /\b\d{5}(?:-\d{4})?\b/.test(keyword);
  if (
    explicitState ||
    explicitStateCode ||
    explicitCity ||
    explicitPostalCode
  ) {
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
