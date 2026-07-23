import {
  agentServicePlans,
  type AgentServicePlanKey,
} from "../agent-service/catalog";
import {
  retailBillingPlans,
  type RetailBillingPlanKey,
} from "../billing/catalog";

export const investmentBlockingReasonCodes = [
  "VALUE_BELOW_PLAN_THRESHOLD",
  "CUSTOMER_PLAN_ROI_BELOW_THRESHOLD",
  "PAYBACK_EXCEEDS_FOCUS_LIMIT",
  "TWELVE_MONTH_ROI_BELOW_THRESHOLD",
  "RANKING_DISTANCE_EXCEEDS_FOCUS_RANGE",
  "ECONOMIC_EVIDENCE_INCOMPLETE",
] as const;

export type InvestmentBlockingReasonCode =
  (typeof investmentBlockingReasonCodes)[number];

export type SeoInvestmentPolicy = {
  planKey: string;
  planLabel: string;
  monthlyPlanPrice: number;
  includedOutcomes: number;
  minimumMonthlyProfit: number;
  minimumCustomerRoiPercent: number;
  maximumPaybackMonths: number;
  minimumTwelveMonthRoiPercent: number;
  minimumConfidence: number;
  maximumExistingPageRank: number;
  maximumStrategicFocusRank: number;
};

type InvestmentInput = {
  expectedMonthlyProfit: number | null | undefined;
  implementationCost: number | null | undefined;
  paybackMonths?: number | null;
  confidenceScore: number | null | undefined;
  currentRank?: number | null;
  actionType?: string | null;
  economicsConfidence?: number | null;
  opportunityScore?: number | null;
  strategicFocus?: boolean;
};

const directPlanKeys = new Set<RetailBillingPlanKey>([
  "starter",
  "growth",
  "pro",
  "autopilot_plus",
]);

const agencyPolicy: Record<
  "agency_core" | "agency_scale",
  { label: string; monthlyPrice: number; outcomes: number; minimumMonthlyProfit: number }
> = {
  agency_core: {
    label: "Agency Managed Core",
    monthlyPrice: 999,
    outcomes: agentServicePlans.agency_core.monthlyActionLimit,
    minimumMonthlyProfit: 200,
  },
  agency_scale: {
    label: "Agency Managed Scale",
    monthlyPrice: 2_299,
    outcomes: agentServicePlans.agency_scale.monthlyActionLimit,
    minimumMonthlyProfit: 200,
  },
};

/**
 * Every included outcome must carry enough conservative monthly gross-profit
 * potential to repay its allocated share of the subscription at least twice.
 * Standard (not promotional) plan pricing is used so beta economics never
 * lower the long-term quality bar.
 */
export function investmentPolicyForPlan(planKey: string): SeoInvestmentPolicy {
  if (directPlanKeys.has(planKey as RetailBillingPlanKey)) {
    const key = planKey as RetailBillingPlanKey;
    const billing = retailBillingPlans[key];
    const service = agentServicePlans[key as AgentServicePlanKey];
    const monthlyPlanPrice = billing.priceCents / 100;
    const includedOutcomes = service.monthlyActionLimit;
    return {
      planKey: key,
      planLabel: billing.label,
      monthlyPlanPrice,
      includedOutcomes,
      minimumMonthlyProfit: Math.ceil(
        Math.max(150, (monthlyPlanPrice / includedOutcomes) * 2),
      ),
      minimumCustomerRoiPercent: 50,
      maximumPaybackMonths: 6,
      minimumTwelveMonthRoiPercent: 200,
      minimumConfidence: 60,
      maximumExistingPageRank: 40,
      maximumStrategicFocusRank: 75,
    };
  }

  const agency = agencyPolicy[
    planKey as keyof typeof agencyPolicy
  ] ?? agencyPolicy.agency_core;
  return {
    planKey: planKey || "agency_core",
    planLabel: agency.label,
    monthlyPlanPrice: agency.monthlyPrice,
    includedOutcomes: agency.outcomes,
    minimumMonthlyProfit: agency.minimumMonthlyProfit,
    minimumCustomerRoiPercent: 50,
    maximumPaybackMonths: 6,
    minimumTwelveMonthRoiPercent: 200,
    minimumConfidence: 60,
    maximumExistingPageRank: 40,
    maximumStrategicFocusRank: 75,
  };
}

const finite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const existingPageActions = new Set([
  "IMPROVE",
  "LINK",
  "DEFEND",
  "CTR_WIN",
  "CONVERSION",
]);

export function evaluateSeoInvestment(
  input: InvestmentInput,
  policy: SeoInvestmentPolicy,
) {
  const expectedMonthlyProfit = finite(input.expectedMonthlyProfit) ?? 0;
  const implementationCost = Math.max(0, finite(input.implementationCost) ?? 0);
  const confidenceScore = Math.max(0, finite(input.confidenceScore) ?? 0);
  const currentRank = finite(input.currentRank);
  const suppliedPayback = finite(input.paybackMonths);
  const paybackMonths =
    suppliedPayback ??
    (expectedMonthlyProfit > 0 && implementationCost > 0
      ? implementationCost / expectedMonthlyProfit
      : null);
  const twelveMonthGrossProfit = expectedMonthlyProfit * 12;
  const twelveMonthNetValue = twelveMonthGrossProfit - implementationCost;
  const twelveMonthRoiPercent =
    implementationCost > 0
      ? (twelveMonthNetValue / implementationCost) * 100
      : expectedMonthlyProfit > 0
        ? Number.POSITIVE_INFINITY
        : 0;
  const allocatedMonthlyPlanCost = input.strategicFocus
    ? policy.monthlyPlanPrice
    : policy.monthlyPlanPrice / Math.max(1, policy.includedOutcomes);
  const requiredMonthlyProfit = Math.max(
    policy.minimumMonthlyProfit,
    allocatedMonthlyPlanCost *
      (1 + policy.minimumCustomerRoiPercent / 100),
  );
  const customerTwelveMonthCost = allocatedMonthlyPlanCost * 12;
  const customerTwelveMonthNetValue =
    twelveMonthGrossProfit - customerTwelveMonthCost;
  const customerTwelveMonthRoiPercent =
    customerTwelveMonthCost > 0
      ? (customerTwelveMonthNetValue / customerTwelveMonthCost) * 100
      : 0;
  const reasons: InvestmentBlockingReasonCode[] = [];

  if (expectedMonthlyProfit < requiredMonthlyProfit)
    reasons.push("VALUE_BELOW_PLAN_THRESHOLD");
  if (
    customerTwelveMonthRoiPercent < policy.minimumCustomerRoiPercent
  )
    reasons.push("CUSTOMER_PLAN_ROI_BELOW_THRESHOLD");
  if (
    paybackMonths == null ||
    paybackMonths > policy.maximumPaybackMonths
  )
    reasons.push("PAYBACK_EXCEEDS_FOCUS_LIMIT");
  if (twelveMonthRoiPercent < policy.minimumTwelveMonthRoiPercent)
    reasons.push("TWELVE_MONTH_ROI_BELOW_THRESHOLD");
  if (
    currentRank != null &&
    currentRank >
      (input.strategicFocus
        ? policy.maximumStrategicFocusRank
        : policy.maximumExistingPageRank) &&
    existingPageActions.has(String(input.actionType ?? "").toUpperCase())
  )
    reasons.push("RANKING_DISTANCE_EXCEEDS_FOCUS_RANGE");
  if (
    confidenceScore < policy.minimumConfidence ||
    (finite(input.economicsConfidence) ?? 0) < 0.2
  )
    reasons.push("ECONOMIC_EVIDENCE_INCOMPLETE");

  const valueStrength = Math.min(
    100,
    (expectedMonthlyProfit / Math.max(1, requiredMonthlyProfit)) * 50,
  );
  const roiStrength = Math.min(
    100,
    (Math.max(0, twelveMonthRoiPercent) /
      policy.minimumTwelveMonthRoiPercent) *
      50,
  );
  const rankStrength =
    currentRank == null
      ? 45
      : currentRank <= 10
        ? 100
        : currentRank <= 20
          ? 80
          : currentRank <= policy.maximumExistingPageRank
            ? 60
            : input.strategicFocus &&
                currentRank <= policy.maximumStrategicFocusRank
              ? 50
            : 15;
  const focusScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        valueStrength * 0.4 +
          roiStrength * 0.25 +
          rankStrength * 0.2 +
          confidenceScore * 0.1 +
          (finite(input.opportunityScore) ?? 0) * 0.05,
      ),
    ),
  );

  return {
    qualified: reasons.length === 0,
    reasons,
    focusScore,
    expectedMonthlyProfit: +expectedMonthlyProfit.toFixed(2),
    implementationCost: +implementationCost.toFixed(2),
    paybackMonths:
      paybackMonths == null ? null : +paybackMonths.toFixed(2),
    twelveMonthGrossProfit: +twelveMonthGrossProfit.toFixed(2),
    twelveMonthNetValue: +twelveMonthNetValue.toFixed(2),
    twelveMonthRoiPercent: Number.isFinite(twelveMonthRoiPercent)
      ? +twelveMonthRoiPercent.toFixed(0)
      : null,
    allocatedMonthlyPlanCost: +allocatedMonthlyPlanCost.toFixed(2),
    requiredMonthlyProfit: +requiredMonthlyProfit.toFixed(2),
    customerTwelveMonthCost: +customerTwelveMonthCost.toFixed(2),
    customerTwelveMonthNetValue: +customerTwelveMonthNetValue.toFixed(2),
    customerTwelveMonthRoiPercent:
      +customerTwelveMonthRoiPercent.toFixed(0),
    currentRank,
    policy,
  };
}
