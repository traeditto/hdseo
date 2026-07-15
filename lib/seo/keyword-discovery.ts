import { scoreOpportunity, type ActionType } from "./opportunity-engine";

type ProviderRecord = Record<string, unknown>;

export interface DiscoveredKeyword {
  keyword: string;
  normalizedKeyword: string;
  searchVolume: number;
  cpc: number;
  difficulty: number | null;
  intent: string | null;
  commercialIntentScore: number;
  currentRank: number | null;
  rankingUrl: string | null;
  actionType: ActionType;
  targetMilestone: string;
  targetRank: number;
  opportunityScore: number;
  confidenceScore: number;
  priority: "critical" | "high" | "medium" | "low";
  estimatedMonthlyValue: number;
  estimatedEffort: number;
  valuePerDollar: number;
  reasonCodes: string[];
  recommendedActions: string[];
}

const record = (value: unknown): ProviderRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ProviderRecord)
    : {};

const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

function providerItems(results: unknown[]): ProviderRecord[] {
  const items: ProviderRecord[] = [];
  for (const result of results) {
    const resultRecord = record(result);
    if (Array.isArray(resultRecord.items)) {
      for (const item of resultRecord.items) {
        const itemRecord = record(item);
        if (Object.keys(itemRecord).length) items.push(itemRecord);
      }
      continue;
    }
    if (Object.keys(resultRecord).length) items.push(resultRecord);
  }
  return items;
}

export function countDiscoveredKeywordRecords(results: unknown[]): number {
  return providerItems(results).length;
}

function commercialIntent(intent: string | null, cpc: number): number {
  const intentScore: Record<string, number> = {
    transactional: 95,
    commercial: 85,
    navigational: 50,
    informational: 38,
  };
  return Math.round(
    clamp((intentScore[intent?.toLowerCase() ?? ""] ?? 48) + Math.min(cpc, 40)),
  );
}

function targetRankFor(milestone: string): number {
  if (milestone === "Position 1") return 1;
  const match = milestone.match(/\d+/);
  return match ? Number(match[0]) : 10;
}

function projectedCtr(rank: number): number {
  if (rank <= 1) return 0.28;
  if (rank <= 3) return 0.16;
  if (rank <= 5) return 0.09;
  if (rank <= 10) return 0.045;
  if (rank <= 20) return 0.018;
  return 0.006;
}

/**
 * Converts domain-ranked keyword data into a budget-aware opportunity list.
 * Values are directional estimates used for prioritization, not revenue claims.
 */
export function discoverKeywordCandidates(
  results: unknown[],
  monthlyBudget: number,
  maxCandidates = 25,
): DiscoveredKeyword[] {
  const candidates = new Map<string, DiscoveredKeyword>();

  for (const item of providerItems(results)) {
    const keywordData = Object.keys(record(item.keyword_data)).length
      ? record(item.keyword_data)
      : item;
    const keywordInfo = record(keywordData.keyword_info);
    const keywordProperties = record(keywordData.keyword_properties);
    const intentInfo = record(keywordData.search_intent_info);
    const rankedElement = record(item.ranked_serp_element);
    const serpItem = record(rankedElement.serp_item);

    const keyword = String(keywordData.keyword ?? item.keyword ?? "").trim();
    const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, " ");
    const currentRank = number(
      serpItem.rank_absolute ?? serpItem.rank_group ?? item.rank_absolute,
    );
    const searchVolume = number(keywordInfo.search_volume ?? item.search_volume) ?? 0;
    const cpc = number(keywordInfo.cpc ?? item.cpc) ?? 0;
    const difficulty = number(
      keywordProperties.keyword_difficulty ?? item.keyword_difficulty,
    );
    const intentValue = intentInfo.main_intent ?? item.search_intent;
    const intent = typeof intentValue === "string" ? intentValue : null;

    if (
      keyword.length < 2 ||
      keyword.length > 200 ||
      (currentRank != null && (currentRank < 1 || currentRank > 100)) ||
      searchVolume <= 0
    ) {
      continue;
    }

    const commercialIntentScore = commercialIntent(intent, cpc);
    const base = scoreOpportunity({
      currentRank,
      searchVolume,
      cpc,
      commercialIntentScore,
      serviceRelevance: 70,
      locationRelevance: 70,
      competitorGap: null,
      technicalReadiness: 60,
      hasOwnerPage: currentRank != null,
      internalLinkCount: null,
    });

    const targetRank = targetRankFor(base.targetMilestone);
    const targetCtr = projectedCtr(targetRank);
    const currentCtr = currentRank == null ? 0 : projectedCtr(currentRank);
    const estimatedMonthlyValue = Math.round(
      searchVolume * Math.max(0.01, targetCtr - currentCtr) * Math.max(cpc, 1),
    );
    const estimatedEffort = Math.round(
      200 +
        (difficulty ?? 55) * 12 +
        Math.max(0, (currentRank ?? 50) - 10) * 10,
    );
    const affordableEffort = Math.max(100, Math.min(monthlyBudget, estimatedEffort));
    const valuePerDollar = Number(
      (estimatedMonthlyValue / affordableEffort).toFixed(2),
    );
    const roiScore = clamp(Math.log10(1 + valuePerDollar) * 42);
    const difficultyFit = 100 - (difficulty ?? 55);
    const budgetFit = clamp((monthlyBudget / estimatedEffort) * 100);
    const opportunityScore = Math.round(
      clamp(base.opportunityScore * 0.55 + roiScore * 0.25 + difficultyFit * 0.1 + budgetFit * 0.1),
    );
    const priority =
      opportunityScore >= 90
        ? "critical"
        : opportunityScore >= 75
          ? "high"
          : opportunityScore >= 55
            ? "medium"
            : "low";
    const serpInfo = record(item.serp_info);
    const rankingUrlValue =
      serpItem.url ?? item.url ?? serpInfo.relevant_url ?? serpInfo.url;
    const candidate: DiscoveredKeyword = {
      keyword,
      normalizedKeyword,
      searchVolume: Math.round(searchVolume),
      cpc: Number(cpc.toFixed(2)),
      difficulty: difficulty == null ? null : Math.round(difficulty),
      intent,
      commercialIntentScore,
      currentRank: currentRank == null ? null : Math.round(currentRank),
      rankingUrl: typeof rankingUrlValue === "string" ? rankingUrlValue : null,
      actionType: base.actionType,
      targetMilestone: base.targetMilestone,
      targetRank,
      opportunityScore,
      confidenceScore: Math.max(55, base.confidenceScore),
      priority,
      estimatedMonthlyValue,
      estimatedEffort,
      valuePerDollar,
      reasonCodes: [...base.reasonCodes, "BUDGET_VALUE", "DOMAIN_DISCOVERY"],
      recommendedActions: base.recommendedActions,
    };

    const previous = candidates.get(normalizedKeyword);
    const addsRankingEvidence =
      candidate.currentRank != null && previous?.currentRank == null;
    if (
      !previous ||
      addsRankingEvidence ||
      ((candidate.currentRank == null) === (previous.currentRank == null) &&
        candidate.opportunityScore > previous.opportunityScore)
    ) {
      candidates.set(normalizedKeyword, candidate);
    }
  }

  return [...candidates.values()]
    .sort(
      (a, b) =>
        b.opportunityScore - a.opportunityScore ||
        b.estimatedMonthlyValue - a.estimatedMonthlyValue,
    )
    .slice(0, maxCandidates);
}
