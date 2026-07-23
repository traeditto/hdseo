import {
  evaluateSeoInvestment,
  investmentBlockingReasonCodes,
  investmentPolicyForPlan,
  type SeoInvestmentPolicy,
} from "../seo/investment-policy";
import { executionCapacityForOpportunity } from "./execution-capacity";

export type ManagedOpportunityCandidate = {
  id: string;
  opportunity_score: number | null;
  confidence_score: number | null;
  action_type: string | null;
  target_url: string | null;
  reason_codes: string[] | null;
  recommended_actions?: unknown;
  evidence: unknown;
  status: string;
  cooldown_until?: string | null;
};

const blockingReasonCodes = new Set([
  "ACTIVE_DUPLICATE",
  "CONFIDENCE_BELOW_THRESHOLD",
  "COOLDOWN_ACTIVE",
  "LOCATION_EXCLUDED",
  "MARKET_SCOPE_MISMATCH",
  "NO_EXPECTED_BUSINESS_VALUE",
  "PAGE_OWNERSHIP_CONFLICT",
  "PAYBACK_EXCEEDS_AUTOPILOT_LIMIT",
  ...investmentBlockingReasonCodes,
  "QUERY_TOO_BROAD",
  "QUERY_TOO_LONG",
  "REDUNDANT_QUERY",
  "REQUIRED_EVIDENCE_MISSING",
  "SERVICE_CAPACITY_UNAVAILABLE",
  "SERVICE_NOT_VERIFIED",
]);
const investmentReasonCodes = new Set<string>(investmentBlockingReasonCodes);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const metricNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function hasUsableTarget(value: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizedTarget(value: string | null) {
  if (!hasUsableTarget(value)) return null;
  const url = new URL(value!);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function uniqueStrings(values: unknown[]) {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ),
    ),
  ];
}

/**
 * Selects only opportunities that the implementation and monitoring pipeline
 * can finish without guessing a page, geography, or business value.
 */
export function selectManagedOpportunity(
  candidates: ManagedOpportunityCandidate[],
  marketScope: "service_area" | "nationwide",
  now = new Date(),
  policy: SeoInvestmentPolicy = investmentPolicyForPlan("pro"),
  availableCapacity = policy.includedOutcomes,
) {
  const evaluate = (candidate: ManagedOpportunityCandidate) => {
    const evidence = record(candidate.evidence);
    const value = record(evidence.businessValue);
    const capacityUnits = executionCapacityForOpportunity({
      actionType: candidate.action_type,
      evidence,
      recommendedActions: candidate.recommended_actions,
      monthlyCapacity: policy.includedOutcomes,
    });
    const investment = evaluateSeoInvestment(
      {
        expectedMonthlyProfit: metricNumber(value.expectedMonthlyProfit),
        implementationCost: metricNumber(value.implementationCost),
        paybackMonths: metricNumber(value.paybackMonths),
        confidenceScore: candidate.confidence_score,
        currentRank: metricNumber(evidence.currentRank),
        actionType: candidate.action_type,
        economicsConfidence: metricNumber(evidence.economicsConfidence),
        opportunityScore: candidate.opportunity_score,
        strategicFocus: record(evidence.focusCampaign).active === true,
        capacityUnits,
      },
      policy,
    );
    const confidence = Math.max(
      0,
      Math.min(1, Number(candidate.confidence_score ?? 0) / 100),
    );
    const confidenceAdjustedMonthlyProfit =
      investment.expectedMonthlyProfit * confidence;
    const monthlyNetValue =
      confidenceAdjustedMonthlyProfit -
      investment.allocatedMonthlyPlanCost -
      investment.implementationCost / 12;
    return {
      investment,
      capacityUnits,
      portfolioScore:
        monthlyNetValue * 10 +
        investment.focusScore +
        Number(candidate.opportunity_score ?? 0),
    };
  };

  const directlyQualified =
    candidates
      .filter((candidate) => {
        if (!["open", "selected", "approved"].includes(candidate.status))
          return false;
        if (!hasUsableTarget(candidate.target_url)) return false;
        if (Number(candidate.confidence_score ?? 0) < 55) return false;
        if (
          candidate.cooldown_until &&
          new Date(candidate.cooldown_until).getTime() > now.getTime()
        )
          return false;

        const reasons = new Set(candidate.reason_codes ?? []);
        if ([...reasons].some((reason) => blockingReasonCodes.has(reason)))
          return false;
        if (
          marketScope === "service_area" &&
          !reasons.has("LOCAL_RELEVANCE") &&
          !reasons.has("TARGET_MARKET_SCOPED")
        )
          return false;

        const evidence = record(candidate.evidence);
        const { investment, capacityUnits } = evaluate(candidate);
        if (capacityUnits > availableCapacity) return false;
        if (!investment.qualified) return false;
        if (investment.focusScore < 55) return false;
        if (
          Array.isArray(evidence.missingEvidence) &&
          evidence.missingEvidence.length > 3
        )
          return false;
        return true;
      })
      .sort((a, b) => {
        return evaluate(b).portfolioScore - evaluate(a).portfolioScore;
      })[0] ?? null;
  if (directlyQualified) return directlyQualified;

  // A single page can legitimately serve several closely related searches.
  // When no individual query repays its allocated plan share, evaluate the
  // page-level campaign as one conservative portfolio instead of either
  // manufacturing busywork or leaving the customer with an empty dashboard.
  const portfolioCandidates = candidates.filter((candidate) => {
    if (!["open", "selected", "approved"].includes(candidate.status))
      return false;
    if (!normalizedTarget(candidate.target_url)) return false;
    if (Number(candidate.confidence_score ?? 0) < 55) return false;
    if (
      candidate.cooldown_until &&
      new Date(candidate.cooldown_until).getTime() > now.getTime()
    )
      return false;
    const reasons = new Set(candidate.reason_codes ?? []);
    if (
      [...reasons].some(
        (reason) =>
          blockingReasonCodes.has(reason) && !investmentReasonCodes.has(reason),
      )
    )
      return false;
    if (
      marketScope === "service_area" &&
      !reasons.has("LOCAL_RELEVANCE") &&
      !reasons.has("TARGET_MARKET_SCOPED")
    )
      return false;
    const evidence = record(candidate.evidence);
    const value = record(evidence.businessValue);
    if ((metricNumber(value.expectedMonthlyProfit) ?? 0) <= 0) return false;
    if (
      Array.isArray(evidence.missingEvidence) &&
      evidence.missingEvidence.length > 3
    )
      return false;
    return true;
  });
  const groups = new Map<string, ManagedOpportunityCandidate[]>();
  for (const candidate of portfolioCandidates) {
    const key = normalizedTarget(candidate.target_url);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const portfolios = [...groups.values()].flatMap((group) => {
    const byKeyword = new Map<string, ManagedOpportunityCandidate>();
    for (const candidate of group) {
      const evidence = record(candidate.evidence);
      const keyword = String(evidence.keyword ?? candidate.id)
        .trim()
        .toLocaleLowerCase("en-US");
      const prior = byKeyword.get(keyword);
      const profit = metricNumber(
        record(evidence.businessValue).expectedMonthlyProfit,
      ) ?? 0;
      const priorProfit = prior
        ? (metricNumber(
            record(record(prior.evidence).businessValue).expectedMonthlyProfit,
          ) ?? 0)
        : -1;
      if (!prior || profit > priorProfit) byKeyword.set(keyword, candidate);
    }
    const related = [...byKeyword.values()]
      .sort((a, b) => {
        const aProfit =
          metricNumber(
            record(record(a.evidence).businessValue).expectedMonthlyProfit,
          ) ?? 0;
        const bProfit =
          metricNumber(
            record(record(b.evidence).businessValue).expectedMonthlyProfit,
          ) ?? 0;
        return bProfit - aProfit;
      })
      .slice(0, 6);
    if (related.length < 2) return [];

    const primary = related[0];
    const primaryEvidence = record(primary.evidence);
    const values = related.map((candidate) =>
      record(record(candidate.evidence).businessValue),
    );
    const profits = values.map(
      (value) => metricNumber(value.expectedMonthlyProfit) ?? 0,
    );
    // Related-query forecasts overlap. Count the strongest query in full and
    // only half of each additional query to avoid overstating customer value.
    const expectedMonthlyProfit =
      profits[0] + profits.slice(1).reduce((sum, value) => sum + value * 0.5, 0);
    const implementationCost =
      Math.max(
        ...values.map(
          (value) => metricNumber(value.implementationCost) ?? 0,
        ),
      ) +
      (related.length - 1) * 75;
    const paybackMonths =
      expectedMonthlyProfit > 0
        ? implementationCost / expectedMonthlyProfit
        : null;
    const confidenceScore = Math.max(
      0,
      Math.round(
        related.reduce(
          (sum, candidate) => sum + Number(candidate.confidence_score ?? 0),
          0,
        ) /
          related.length -
          5,
      ),
    );
    const capacityUnits = Math.min(
      availableCapacity,
      policy.includedOutcomes,
      Math.max(2, Math.ceil(related.length / 2)),
    );
    if (capacityUnits < 1) return [];
    const combinedScore = Math.min(
      100,
      Math.max(...related.map((item) => Number(item.opportunity_score ?? 0))) +
        Math.min(15, (related.length - 1) * 4),
    );
    const investment = evaluateSeoInvestment(
      {
        expectedMonthlyProfit,
        implementationCost,
        paybackMonths,
        confidenceScore,
        currentRank: metricNumber(primaryEvidence.currentRank),
        actionType: primary.action_type,
        economicsConfidence: metricNumber(primaryEvidence.economicsConfidence),
        opportunityScore: combinedScore,
        capacityUnits,
      },
      policy,
    );
    if (!investment.qualified || investment.focusScore < 55) return [];

    const keywords = related.map((candidate) =>
      String(record(candidate.evidence).keyword ?? "").trim(),
    );
    const recommendedActions = uniqueStrings([
      `Concentrate one page-level campaign on ${keywords
        .filter(Boolean)
        .slice(0, 3)
        .join(", ")}.`,
      ...related.flatMap((candidate) =>
        Array.isArray(candidate.recommended_actions)
          ? candidate.recommended_actions
          : [],
      ),
    ]);
    const evidence = {
      ...primaryEvidence,
      businessValue: {
        ...record(primaryEvidence.businessValue),
        expectedMonthlyProfit: +expectedMonthlyProfit.toFixed(2),
        implementationCost: +implementationCost.toFixed(2),
        paybackMonths:
          paybackMonths == null ? null : +paybackMonths.toFixed(2),
      },
      investmentDecision: investment,
      portfolioCampaign: {
        active: true,
        capacityUnits,
        targetUrl: primary.target_url,
        sourceOpportunityIds: related.map((candidate) => candidate.id),
        keywords: keywords.filter(Boolean),
        conservativeOverlapDiscount: 0.5,
        explanation:
          "Several related searches support one page-level campaign. HD SEO discounted overlapping forecasts and qualified the combined customer value before allocating capacity.",
      },
    };
    const reasons = (primary.reason_codes ?? []).filter(
      (reason) => !investmentReasonCodes.has(reason),
    );
    return [
      {
        candidate: {
          ...primary,
          opportunity_score: Math.max(combinedScore, investment.focusScore),
          confidence_score: confidenceScore,
          evidence,
          reason_codes: reasons,
          recommended_actions: recommendedActions,
        },
        score:
          investment.expectedMonthlyProfit *
            Math.max(0, confidenceScore / 100) *
            10 +
          investment.focusScore,
      },
    ];
  });

  return (
    portfolios.sort((a, b) => b.score - a.score)[0]?.candidate ?? null
  );
}
