export type ProviderDomain = { name?: string | null; verified?: boolean | null };

export type ProductionValidationCandidate = {
  baseUrl: string;
  hostname: string;
  source: "canonical_domain" | "project_domain" | "verified_vercel_domain" | "configured_domain";
};

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function isPrivateIpv6(hostname: string) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}

function normalizeHostname(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || url.username || url.password || url.port || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa") || isPrivateIpv4(hostname) || (hostname.includes(":") && isPrivateIpv6(hostname))) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function isGeneratedVercelHostname(value: unknown) {
  const hostname = normalizeHostname(value);
  return Boolean(hostname?.endsWith(".vercel.app"));
}

/**
 * Production QA must inspect the public website customers and search engines see.
 * Generated Vercel deployment URLs can be protected even when the custom domain is
 * healthy, so they are deliberately excluded from production candidates.
 */
export function productionValidationCandidates(input: {
  canonicalDomain?: unknown;
  projectDomain?: unknown;
  providerDomains?: ProviderDomain[] | null;
  configuredDomains?: unknown[] | null;
}): ProductionValidationCandidate[] {
  const candidates: ProductionValidationCandidate[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, source: ProductionValidationCandidate["source"]) => {
    const hostname = normalizeHostname(value);
    if (!hostname || isGeneratedVercelHostname(hostname) || seen.has(hostname)) return;
    seen.add(hostname);
    candidates.push({ baseUrl: `https://${hostname}`, hostname, source });
  };

  add(input.canonicalDomain, "canonical_domain");
  add(input.projectDomain, "project_domain");
  for (const domain of input.providerDomains ?? []) if (domain.verified === true) add(domain.name, "verified_vercel_domain");
  for (const domain of input.configuredDomains ?? []) add(domain, "configured_domain");
  return candidates;
}

export function verifiedProviderHostnames(domains: ProviderDomain[] | null | undefined) {
  return [...new Set((domains ?? [])
    .filter(domain => domain.verified === true)
    .map(domain => normalizeHostname(domain.name))
    .filter((hostname): hostname is string => Boolean(hostname)))];
}
