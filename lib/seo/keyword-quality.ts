const root = (token: string) => {
  if (["roof", "roofing", "roofs", "roofer", "roofers"].includes(token))
    return "roof";
  if (["gutter", "gutters"].includes(token)) return "gutter";
  if (["company", "companies"].includes(token)) return "company";
  if (["contractor", "contractors"].includes(token)) return "contractor";
  return token;
};

export function keywordQualityIssues(keyword: string) {
  const tokens = keyword
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const roots = tokens.map(root);
  const issues: string[] = [];
  if (tokens.length < 2) issues.push("QUERY_TOO_BROAD");
  if (roots.some((token, index) => index > 0 && token === roots[index - 1]))
    issues.push("REDUNDANT_QUERY");
  if (tokens.length > 14) issues.push("QUERY_TOO_LONG");
  return issues;
}
