export const retailBillingPlans = {
  starter: { label: "Essentials", priceCents: 19_900 },
  growth: { label: "Growth Copilot", priceCents: 49_900 },
  pro: { label: "Autopilot", priceCents: 99_900 },
  autopilot_plus: { label: "Autopilot Plus", priceCents: 129_900 },
} as const;

export type RetailBillingPlanKey = keyof typeof retailBillingPlans;

export function isRetailBillingPlanKey(value: unknown): value is RetailBillingPlanKey {
  return typeof value === "string" && value in retailBillingPlans;
}
