export interface PageSignal { url: string; title?: string | null; metaDescription?: string | null; h1?: string | null; canonical?: string | null; headings?: string[]; internalLinks?: string[]; assignedKeywords?: string[]; service?: string | null; location?: string | null }
const normalize = (value: string | null | undefined) => value?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
const ignoredTokens = new Set(["and","best","company","companies","contractor","contractors","in","near","service","services","the"]);
const tokenAlias = (token: string) => token === "jax" ? "jacksonville" : token;
const tokens = (value: string) => new Set(normalize(value).split(" ").map(tokenAlias).filter((token) => token.length > 1 && !ignoredTokens.has(token)));
const overlap = (left: Set<string>, right: Set<string>) => left.size ? [...left].filter((value) => right.has(value)).length / left.size : 0;
const urlIdentity = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${url.search}`.toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  }
};

export function analyzePageOwnership(keyword: string, pages: PageSignal[]) {
  const uniquePages = [...new Map(pages.map((page) => [urlIdentity(page.url), page])).values()];
  const keywordTokens = tokens(keyword), normalizedKeyword = normalize(keyword);
  const scored = uniquePages.map((page) => {
    const visible = [page.title, page.metaDescription, page.h1, ...(page.headings ?? []), page.service, page.location].filter(Boolean).join(" ");
    let score = overlap(keywordTokens, tokens(visible)) * 55;
    if ((page.assignedKeywords ?? []).some((value) => normalize(value) === normalizedKeyword)) score += 35;
    if (page.canonical && normalize(page.canonical) === normalize(page.url)) score += 5;
    if ((page.internalLinks ?? []).length >= 3) score += 5;
    return { page, score: Math.round(Math.min(100, score)) };
  }).sort((a, b) => b.score - a.score);
  const owner = (scored[0]?.score ?? 0) >= 30 ? scored[0] : null;
  const competing = owner
    ? scored.filter(
        (entry, index) =>
          index > 0 &&
          (entry.score >= Math.max(45, owner.score * 0.8) ||
            (Boolean(normalize(owner.page.title)) &&
              normalize(entry.page.title) === normalize(owner.page.title)) ||
            (Boolean(entry.page.canonical) &&
              urlIdentity(entry.page.canonical!) ===
                urlIdentity(owner.page.url))),
      )
    : [];
  const relevantPages = owner
    ? [owner.page, ...competing.map((entry) => entry.page)]
    : [];
  const warnings: string[] = [];
  if (competing.length) warnings.push("KEYWORD_CANNIBALIZATION");
  for (const [field, code] of [["title","DUPLICATE_TITLE"],["metaDescription","DUPLICATE_DESCRIPTION"]] as const) {
    const seen = new Set<string>();
    for (const page of relevantPages) { const value = normalize(page[field]); if (value && seen.has(value)) warnings.push(code); else if (value) seen.add(value); }
  }
  for (const page of relevantPages) if (page.canonical && urlIdentity(page.canonical) !== urlIdentity(page.url) && uniquePages.some((candidate) => urlIdentity(candidate.url) === urlIdentity(page.canonical!))) warnings.push("CANONICAL_CONFLICT");
  return { ownerPage: owner?.page ?? null, ownershipConfidence: owner?.score ?? 0, competingPages: competing.map((entry) => entry.page), conflictWarnings: [...new Set(warnings)] };
}
