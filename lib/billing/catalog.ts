export const FOUNDING_BETA_OFFER_KEY = "founding_beta_2026" as const;

export const foundingBetaProgram = {
  offerKey: FOUNDING_BETA_OFFER_KEY,
  label: "Founding Beta",
  enrollmentClosesAt: "2026-09-30T23:59:59-04:00",
  renewalDisclosure: "Founding Beta applies to the first monthly billing period. The subscription then renews at the standard monthly price unless canceled.",
} as const;

export type FoundingBetaOffer = {
  priceCents: number;
  durationDays: number;
  enrollmentLimit: number;
  maxAllInCostCents: number;
  includedFounderMinutes: number;
};

export const retailBillingPlans = {
  starter: {
    label: "Essentials",
    priceCents: 19_900,
    annualPriceCents: 199_000,
    beta: { priceCents: 9_900, durationDays: 30, enrollmentLimit: 5, maxAllInCostCents: 8_500, includedFounderMinutes: 45 },
  },
  growth: {
    label: "Growth Copilot",
    priceCents: 49_900,
    annualPriceCents: 499_000,
    beta: { priceCents: 24_900, durationDays: 30, enrollmentLimit: 5, maxAllInCostCents: 21_500, includedFounderMinutes: 120 },
  },
  pro: {
    label: "Autopilot",
    priceCents: 99_900,
    annualPriceCents: 999_000,
    beta: { priceCents: 59_900, durationDays: 30, enrollmentLimit: 10, maxAllInCostCents: 51_500, includedFounderMinutes: 330 },
  },
  autopilot_plus: {
    label: "Autopilot Plus",
    priceCents: 129_900,
    annualPriceCents: 1_299_000,
    beta: { priceCents: 79_900, durationDays: 30, enrollmentLimit: 5, maxAllInCostCents: 69_000, includedFounderMinutes: 450 },
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
