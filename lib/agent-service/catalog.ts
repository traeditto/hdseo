export type AgentServiceMode="platform"|"copilot"|"managed_agent";
export type AgentApprovalOwner="agency"|"client"|"both";

export const agentServicePlans={
  starter:{label:"Essentials",monthlyActionLimit:2,monthlyMajorPageLimit:0,monthlyProviderBudget:3,humanReviewMinutes:0,cycleCadenceHours:720},
  growth:{label:"Growth Copilot",monthlyActionLimit:6,monthlyMajorPageLimit:0,monthlyProviderBudget:5,humanReviewMinutes:0,cycleCadenceHours:168},
  pro:{label:"Autopilot",monthlyActionLimit:6,monthlyMajorPageLimit:1,monthlyProviderBudget:10,humanReviewMinutes:30,cycleCadenceHours:72},
  autopilot_plus:{label:"Autopilot Plus",monthlyActionLimit:10,monthlyMajorPageLimit:2,monthlyProviderBudget:18,humanReviewMinutes:60,cycleCadenceHours:24},
  agency_core:{label:"Agency Managed Core",monthlyActionLimit:12,monthlyMajorPageLimit:1,monthlyProviderBudget:10,humanReviewMinutes:0,cycleCadenceHours:72},
  agency_scale:{label:"Agency Managed Scale",monthlyActionLimit:24,monthlyMajorPageLimit:2,monthlyProviderBudget:18,humanReviewMinutes:60,cycleCadenceHours:24},
} as const;

export const agentCapacityAddOn={priceCents:1500,providerBudgetPerAction:3} as const;

export type AgentServicePlanKey=keyof typeof agentServicePlans;
export const isAgentServicePlanKey=(value:string):value is AgentServicePlanKey=>value in agentServicePlans;

export const defaultManagedTools=[
  "website.detect","website.crawl","google.search_console.read","google.analytics.read","google.business_profile.read",
  "keywords.discover","competitors.analyze","opportunities.score","strategy.plan","cms.draft","github.read",
  "lighthouse.run","seo.validate","schema.validate","sitemap.verify","robots.verify","report.generate","audit.read",
] as const;

export function planEntitlements(planKey:string){
  return agentServicePlans[isAgentServicePlanKey(planKey)?planKey:"starter"];
}
