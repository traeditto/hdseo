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

  return (
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
      })[0] ?? null
  );
}
