export const agencyBillingPlans = {
  launch: {
    label: "Agency Launch",
    priceCents: 49_900,
    includedClients: 3,
    includedScaleClients: 0,
    description: "For a small agency launching managed SEO for up to three active clients.",
  },
  growth: {
    label: "Agency Growth",
    priceCents: 99_900,
    includedClients: 8,
    includedScaleClients: 2,
    description: "For a growing team managing up to eight active clients with two Scale seats.",
  },
  scale: {
    label: "Agency Scale",
    priceCents: 229_900,
    includedClients: 20,
    includedScaleClients: 5,
    description: "For established agencies managing up to twenty active clients with five Scale seats.",
  },
} as const;

export type AgencyBillingPlanKey = keyof typeof agencyBillingPlans;

export function isAgencyBillingPlanKey(value: unknown): value is AgencyBillingPlanKey {
  return typeof value === "string" && value in agencyBillingPlans;
}
