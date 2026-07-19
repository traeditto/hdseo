export const retailBillingPlans = {
  starter: { label: "Essentials", priceCents: 19_900 },
  growth: { label: "Growth", priceCents: 49_900 },
  pro: { label: "Scale", priceCents: 99_900 },
} as const;

export type RetailBillingPlanKey = keyof typeof retailBillingPlans;

export function isRetailBillingPlanKey(value: unknown): value is RetailBillingPlanKey {
  return typeof value === "string" && value in retailBillingPlans;
}
