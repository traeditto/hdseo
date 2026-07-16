export interface SearchConsoleEvidenceRow {
  query: string | null;
  page_url: string | null;
  clicks: number | string | null;
  impressions: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
}

export interface SearchConsoleKeywordCandidate {
  keyword: string;
  normalizedKeyword: string;
  rankingUrl: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  averagePosition: number | null;
  intent: "transactional" | "commercial" | "informational";
  commercialIntentScore: number;
  priority: number;
}

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const numeric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function normalizeKeyword(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function classifyIntent(keyword: string): SearchConsoleKeywordCandidate["intent"] {
  if (/\b(buy|book|call|hire|quote|pricing|price|near me|schedule|order|service)\b/i.test(keyword)) {
    return "transactional";
  }
  if (/\b(best|top|review|compare|comparison|vs|alternative|cost)\b/i.test(keyword)) {
    return "commercial";
  }
  return "informational";
}

function intentScore(intent: SearchConsoleKeywordCandidate["intent"]) {
  return intent === "transactional" ? 95 : intent === "commercial" ? 82 : 42;
}

function expectedCtr(position: number | null) {
  if (position == null) return 0;
  if (position <= 1) return 0.28;
  if (position <= 3) return 0.16;
  if (position <= 5) return 0.09;
  if (position <= 10) return 0.045;
  if (position <= 20) return 0.018;
  return 0.006;
}

/**
 * Converts first-party Search Console rows into keyword candidates. Impressions
 * remain first-party visibility evidence and are never mislabeled as search volume.
 */
export function discoverSearchConsoleCandidates(
  rows: SearchConsoleEvidenceRow[],
  maxCandidates = 100,
): SearchConsoleKeywordCandidate[] {
  const grouped = new Map<
    string,
    {
      keyword: string;
      clicks: number;
      impressions: number;
      weightedPosition: number;
      positionWeight: number;
      pages: Map<string, number>;
    }
  >();

  for (const row of rows) {
    const keyword = String(row.query ?? "").trim();
    const normalizedKeyword = normalizeKeyword(keyword);
    if (normalizedKeyword.length < 2 || normalizedKeyword.length > 200) continue;
    const impressions = Math.max(0, numeric(row.impressions));
    const clicks = Math.max(0, numeric(row.clicks));
    const position = numeric(row.average_position);
    const weight = Math.max(1, impressions);
    const current = grouped.get(normalizedKeyword) ?? {
      keyword,
      clicks: 0,
      impressions: 0,
      weightedPosition: 0,
      positionWeight: 0,
      pages: new Map<string, number>(),
    };
    current.clicks += clicks;
    current.impressions += impressions;
    if (position > 0 && position <= 100) {
      current.weightedPosition += position * weight;
      current.positionWeight += weight;
    }
    if (row.page_url) {
      current.pages.set(
        row.page_url,
        (current.pages.get(row.page_url) ?? 0) + impressions,
      );
    }
    grouped.set(normalizedKeyword, current);
  }

  return [...grouped.entries()]
    .map(([normalizedKeyword, item]) => {
      const averagePosition = item.positionWeight
        ? item.weightedPosition / item.positionWeight
        : null;
      const ctr = item.impressions > 0 ? item.clicks / item.impressions : 0;
      const intent = classifyIntent(item.keyword);
      const commercialIntentScore = intentScore(intent);
      const visibility = clamp(Math.log10(item.impressions + 1) * 24);
      const strikingDistance =
        averagePosition == null
          ? 5
          : averagePosition <= 3
            ? 12
            : averagePosition <= 10
              ? 30
              : averagePosition <= 20
                ? 22
                : averagePosition <= 40
                  ? 10
                  : 4;
      const ctrGap = clamp(
        (expectedCtr(averagePosition) - ctr) * 500,
        0,
        20,
      );
      const priority = Math.round(
        clamp(
          visibility * 0.45 +
            strikingDistance +
            ctrGap +
            commercialIntentScore * 0.18,
        ),
      );
      const rankingUrl = [...item.pages.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0] ?? null;
      return {
        keyword: item.keyword,
        normalizedKeyword,
        rankingUrl,
        clicks: Math.round(item.clicks),
        impressions: Math.round(item.impressions),
        ctr: Number(ctr.toFixed(6)),
        averagePosition:
          averagePosition == null ? null : Number(averagePosition.toFixed(2)),
        intent,
        commercialIntentScore,
        priority,
      };
    })
    .filter((candidate) => candidate.impressions > 0 || candidate.clicks > 0)
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.impressions - a.impressions ||
        b.clicks - a.clicks,
    )
    .slice(0, maxCandidates);
}
