import {
  evaluateSeoInvestment,
  type SeoInvestmentPolicy,
} from "../seo/investment-policy";

type RunwayCandidate = {
  id: string;
  status: string;
  action_type: string;
  target_url: string | null;
  opportunity_score: number | null;
  confidence_score: number | null;
  reason_codes: string[] | null;
  evidence: unknown;
};

export type GrowthRunwayItem = {
  id: string;
  selected: boolean;
  targetUrl: string;
  actionType: string;
  keywords: string[];
  currentMonthlyProfit: number;
  requiredMonthlyProfit: number;
  monthlyProfitGap: number;
  valueCoveragePercent: number;
  confidenceScore: number;
  currentRank: number | null;
  capacityUnits: number;
  blockingReasons: string[];
  milestones: string[];
  explanation: string;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function normalizedTarget(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hostname = url.hostname.replace(/^www\./, "");
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

const unsafeReasons = new Set([
  "OUTSIDE_SERVICE_AREA",
  "GEOGRAPHY_UNVERIFIED",
  "SERVICE_NOT_VERIFIED",
  "REDUNDANT_QUERY",
  "TARGET_CONFLICT",
  "NO_VERIFIED_TARGET",
]);

function milestonesFor(
  reasons: string[],
  evaluation: ReturnType<typeof evaluateSeoInvestment>,
) {
  const milestones: string[] = [];
  if (reasons.includes("ECONOMIC_EVIDENCE_INCOMPLETE"))
    milestones.push(
      "Strengthen conversion evidence with qualified leads, closed revenue, or better cost-per-click data.",
    );
  if (reasons.includes("RANKING_DISTANCE_EXCEEDS_FOCUS_RANGE"))
    milestones.push(
      `Build topical authority and internal links until the observed position reaches approximately the top ${evaluation.policy.maximumStrategicFocusRank}.`,
    );
  if (
    reasons.includes("VALUE_BELOW_PLAN_THRESHOLD") ||
    reasons.includes("CUSTOMER_PLAN_ROI_BELOW_THRESHOLD")
  )
    milestones.push(
      `Expand only closely related, high-intent searches until conservative modeled monthly profit reaches ${new Intl.NumberFormat(
        "en-US",
        { style: "currency", currency: "USD", maximumFractionDigits: 0 },
      ).format(evaluation.requiredMonthlyProfit)}.`,
    );
  if (reasons.includes("PAYBACK_EXCEEDS_FOCUS_LIMIT"))
    milestones.push(
      "Use lower-cost foundation improvements first, then remeasure the payback period.",
    );
  if (reasons.includes("TWELVE_MONTH_ROI_BELOW_THRESHOLD"))
    milestones.push(
      "Recheck the twelve-month forecast after rankings and conversion evidence improve.",
    );
  return [
    ...new Set(
      milestones.length
        ? milestones
        : ["Collect the next ranking and conversion checkpoint, then rerun the ROI model."],
    ),
  ].slice(0, 3);
}

/**
 * Shows promising work without weakening the execution guardrail. Related
 * searches are evaluated as one page-level sequence with a 50% overlap
 * discount. Nothing returned here is authorized or billable.
 */
export function buildGrowthRunway(
  candidates: RunwayCandidate[],
  marketScope: "service_area" | "nationwide",
  policy: SeoInvestmentPolicy,
): GrowthRunwayItem[] {
  const groups = new Map<string, RunwayCandidate[]>();
  for (const candidate of candidates) {
    if (!["open", "selected", "approved"].includes(candidate.status)) continue;
    const target = normalizedTarget(candidate.target_url);
    if (!target) continue;
    const reasons = candidate.reason_codes ?? [];
    if (reasons.some((reason) => unsafeReasons.has(reason))) continue;
    if (
      marketScope === "service_area" &&
      !reasons.includes("LOCAL_RELEVANCE") &&
      !reasons.includes("TARGET_MARKET_SCOPED")
    )
      continue;
    const evidence = record(candidate.evidence);
    const profit = number(record(evidence.businessValue).expectedMonthlyProfit);
    if (profit == null || profit <= 0) continue;
    const group = groups.get(target) ?? [];
    group.push(candidate);
    groups.set(target, group);
  }

  return [...groups.entries()]
    .flatMap(([targetUrl, group]) => {
      const unique = new Map<string, RunwayCandidate>();
      for (const candidate of group) {
        const keyword = String(record(candidate.evidence).keyword ?? candidate.id)
          .trim()
          .toLocaleLowerCase("en-US");
        const prior = unique.get(keyword);
        const candidateProfit =
          number(record(record(candidate.evidence).businessValue).expectedMonthlyProfit) ??
          0;
        const priorProfit = prior
          ? number(
              record(record(prior.evidence).businessValue).expectedMonthlyProfit,
            ) ?? 0
          : -1;
        if (!prior || candidateProfit > priorProfit) unique.set(keyword, candidate);
      }
      const related = [...unique.values()]
        .sort(
          (a, b) =>
            (number(record(record(b.evidence).businessValue).expectedMonthlyProfit) ??
              0) -
            (number(record(record(a.evidence).businessValue).expectedMonthlyProfit) ??
              0),
        )
        .slice(0, 6);
      if (!related.length) return [];
      const primary = related[0];
      const values = related.map((candidate) =>
        record(record(candidate.evidence).businessValue),
      );
      const profits = values.map(
        (value) => number(value.expectedMonthlyProfit) ?? 0,
      );
      const currentMonthlyProfit =
        profits[0] + profits.slice(1).reduce((sum, value) => sum + value * 0.5, 0);
      const implementationCost =
        Math.max(...values.map((value) => number(value.implementationCost) ?? 0)) +
        Math.max(0, related.length - 1) * 75;
      const confidenceScore = Math.max(
        0,
        Math.round(
          related.reduce(
            (sum, candidate) => sum + Number(candidate.confidence_score ?? 0),
            0,
          ) / related.length - (related.length > 1 ? 5 : 0),
        ),
      );
      const primaryEvidence = record(primary.evidence);
      const selected = related.some(
        (candidate) =>
          record(record(candidate.evidence).customerFocus).active === true,
      );
      const capacityUnits = Math.min(
        policy.includedOutcomes,
        Math.max(1, Math.ceil(related.length / 2)),
      );
      const evaluation = evaluateSeoInvestment(
        {
          expectedMonthlyProfit: currentMonthlyProfit,
          implementationCost,
          confidenceScore,
          currentRank: number(primaryEvidence.currentRank),
          actionType: primary.action_type,
          economicsConfidence: number(primaryEvidence.economicsConfidence),
          opportunityScore: Math.max(
            ...related.map((candidate) => Number(candidate.opportunity_score ?? 0)),
          ),
          capacityUnits,
        },
        policy,
      );
      if (evaluation.qualified) return [];
      const blockingReasons = [...new Set(evaluation.reasons)];
      const keywords = related
        .map((candidate) => String(record(candidate.evidence).keyword ?? "").trim())
        .filter(Boolean);
      return [
        {
          id: primary.id,
          selected,
          targetUrl,
          actionType: primary.action_type,
          keywords,
          currentMonthlyProfit: evaluation.expectedMonthlyProfit,
          requiredMonthlyProfit: evaluation.requiredMonthlyProfit,
          monthlyProfitGap: +Math.max(
            0,
            evaluation.requiredMonthlyProfit - evaluation.expectedMonthlyProfit,
          ).toFixed(2),
          valueCoveragePercent: Math.min(
            100,
            Math.round(
              (evaluation.expectedMonthlyProfit /
                Math.max(1, evaluation.requiredMonthlyProfit)) *
                100,
            ),
          ),
          confidenceScore,
          currentRank: evaluation.currentRank,
          capacityUnits,
          blockingReasons,
          milestones: milestonesFor(blockingReasons, evaluation),
          explanation:
            "This is a watched compound-growth path, not approved work. HD SEO will combine only related searches, refresh the evidence after each checkpoint, and start execution only when the conservative campaign forecast clears the customer ROI guardrail.",
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.selected) - Number(a.selected) ||
        b.valueCoveragePercent - a.valueCoveragePercent ||
        b.confidenceScore - a.confidenceScore,
    )
    .slice(0, 3);
}
