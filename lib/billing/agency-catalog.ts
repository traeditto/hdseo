import type {FoundingBetaOffer} from "./catalog";

export const agencyBillingPlans = {
  launch: {
    label: "Agency Launch",
    priceCents: 49_900,
    annualPriceCents: 499_000,
    includedClients: 3,
    includedScaleClients: 0,
    beta: {priceCents:29_900,durationDays:30,enrollmentLimit:3,maxAllInCostCents:25_700,includedFounderMinutes:150},
    description: "For a small agency launching managed SEO for up to three active clients.",
  },
  growth: {
    label: "Agency Growth",
    priceCents: 99_900,
    annualPriceCents: 999_000,
    includedClients: 8,
    includedScaleClients: 2,
    beta: {priceCents:59_900,durationDays:30,enrollmentLimit:3,maxAllInCostCents:51_500,includedFounderMinutes:330},
    description: "For a growing team managing up to eight active clients with two Scale seats.",
  },
  scale: {
    label: "Agency Scale",
    priceCents: 229_900,
    annualPriceCents: 2_299_000,
    includedClients: 20,
    includedScaleClients: 5,
    beta: {priceCents:129_900,durationDays:30,enrollmentLimit:2,maxAllInCostCents:111_700,includedFounderMinutes:720},
    description: "For established agencies managing up to twenty active clients with five Scale seats.",
  },
} as const satisfies Record<string,{label:string;priceCents:number;annualPriceCents:number;includedClients:number;includedScaleClients:number;beta:FoundingBetaOffer;description:string}>;

export type AgencyBillingPlanKey = keyof typeof agencyBillingPlans;

export function isAgencyBillingPlanKey(value: unknown): value is AgencyBillingPlanKey {
  return typeof value === "string" && value in agencyBillingPlans;
}
