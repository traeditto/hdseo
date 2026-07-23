export const FOUNDING_BETA_OFFER_KEY = "founding_beta_2026" as const;

export const foundingBetaProgram = {
  offerKey: FOUNDING_BETA_OFFER_KEY,
  label: "Founding Beta",
  enrollmentClosesAt: "2026-09-30T23:59:59-04:00",
  targetContributionMarginPercent: 25,
  measurementWindowDays: 90,
  renewalDisclosure: "Founding Beta applies to the first monthly billing period. The subscription then renews at the standard monthly price unless canceled.",
} as const;

export type FoundingBetaOffer = {
  priceCents: number;
  durationDays: number;
  enrollmentLimit: number;
  maxAllInCostCents: number;
  fixedDeliveryReserveCents: number;
  includedProviderBudgetDollars: number;
  includedFounderMinutes: number;
};

export const retailBillingPlans = {
  starter: {
    label: "Essentials",
    priceCents: 19_900,
    annualPriceCents: 199_000,
    beta: { priceCents: 9_900, durationDays: 30, enrollmentLimit: 5, maxAllInCostCents: 7_425, fixedDeliveryReserveCents: 2_500, includedProviderBudgetDollars: 8, includedFounderMinutes: 45 },
  },
  growth: {
    label: "Growth Copilot",
    priceCents: 49_900,
    annualPriceCents: 499_000,
    beta: { priceCents: 24_900, durationDays: 30, enrollmentLimit: 5, maxAllInCostCents: 18_675, fixedDeliveryReserveCents: 10_000, includedProviderBudgetDollars: 25, includedFounderMinutes: 120 },
  },
  pro: {
    label: "Autopilot",
    priceCents: 99_900,
    annualPriceCents: 999_000,
    beta: { priceCents: 59_900, durationDays: 30, enrollmentLimit: 10, maxAllInCostCents: 44_925, fixedDeliveryReserveCents: 31_800, includedProviderBudgetDollars: 60, includedFounderMinutes: 330 },
  },
  autopilot_plus: {
    label: "Autopilot Plus",
    priceCents: 129_900,
    annualPriceCents: 1_299_000,
    beta: { priceCents: 79_900, durationDays: 30, enrollmentLimit: 5, maxAllInCostCents: 59_925, fixedDeliveryReserveCents: 43_400, includedProviderBudgetDollars: 90, includedFounderMinutes: 450 },
  },
} as const satisfies Record<string, { label: string; priceCents: number; annualPriceCents: number; beta: FoundingBetaOffer }>;

export type RetailBillingPlanKey = keyof typeof retailBillingPlans;

export function isRetailBillingPlanKey(value: unknown): value is RetailBillingPlanKey {
  return typeof value === "string" && value in retailBillingPlans;
}

export function isFoundingBetaOffer(value: unknown): value is typeof FOUNDING_BETA_OFFER_KEY {
  return value === FOUNDING_BETA_OFFER_KEY;
}

export function contributionMarginPercent(priceCents: number, maxAllInCostCents: number) {
  return ((priceCents - maxAllInCostCents) / priceCents) * 100;
}
