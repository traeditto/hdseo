import {agencyBillingPlans} from "@/lib/billing/agency-catalog";
import {retailBillingPlans} from "@/lib/billing/catalog";

export type PricingAudience = "business" | "agency";
export type BillingCadence = "monthly" | "annual";
export type PricingMode = "guide" | "agent-service";

export type MarketingBetaOffer={
  price:number;
  durationDays:number;
  enrollmentLimit:number;
  renewalPrice:number;
};

export type PricingPlan = {
  slug: string;
  audience: PricingAudience;
  name: string;
  monthly: number;
  annual: number;
  label?: string;
  description: string;
  features: string[];
  cta: string;
  supportingText?: string;
  href: string;
  betaOffer: MarketingBetaOffer;
};

export const pricingPlans: PricingPlan[] = [
  {
    slug: "essentials",
    audience: "business",
    name: "Essentials",
    monthly: retailBillingPlans.starter.priceCents/100,
    annual: retailBillingPlans.starter.annualPriceCents/100,
    description: "For an owner who wants HD SEO to identify and complete the most important foundational work.",
    features: ["1 business website", "1 business location or service area", "Automated website audit", "Google Search Console and GA4 connection", "Local keyword discovery", "Competitor and content-gap research", "Up to 100 tracked keywords", "Monthly technical crawl", "Prioritized opportunity recommendations", "Two standard approved SEO actions per month", "Plain-language approval requests", "Metadata, internal-link, schema, and page-improvement workflows", "Monthly outcome report", "Email support"],
    cta: "Start Essentials Beta",
    supportingText: "First month at the Founding Beta price, then $199/month unless canceled. Nothing publishes without approval.",
    href: "/register?plan=starter",
    betaOffer:{price:retailBillingPlans.starter.beta.priceCents/100,durationDays:retailBillingPlans.starter.beta.durationDays,enrollmentLimit:retailBillingPlans.starter.beta.enrollmentLimit,renewalPrice:retailBillingPlans.starter.priceCents/100},
  },
  {
    slug: "growth",
    audience: "business",
    name: "Growth Copilot",
    monthly: retailBillingPlans.growth.priceCents/100,
    annual: retailBillingPlans.growth.annualPriceCents/100,
    label: "MOST POPULAR",
    description: "For an established service business that wants the intelligence and controls to operate a consistent SEO workflow.",
    features: ["Everything in Essentials", "Up to 3 locations or approved service areas", "Weekly technical crawling", "Up to 500 tracked keywords", "Daily Search Console and analytics synchronization", "Advanced competitor-gap monitoring", "Six guided SEO workflows per month", "New service and location page briefs", "Content refresh and conversion recommendations", "Google Business Profile evidence", "CMS or GitHub preparation through supported connections", "Deployment previews", "Technical SEO and schema validation", "Lighthouse, sitemap, robots, and broken-link checks", "Rollback protection for supported connections", "Lead and conversion attribution", "Priority support"],
    cta: "Choose Growth Copilot",
    supportingText: "You operate the workflow; HD SEO supplies evidence, recommendations, controls, and validation.",
    href: "/register?plan=growth",
    betaOffer:{price:retailBillingPlans.growth.beta.priceCents/100,durationDays:retailBillingPlans.growth.beta.durationDays,enrollmentLimit:retailBillingPlans.growth.beta.enrollmentLimit,renewalPrice:retailBillingPlans.growth.priceCents/100},
  },
  {
    slug: "agency-launch",
    audience: "agency",
    name: agencyBillingPlans.launch.label,
    monthly: agencyBillingPlans.launch.priceCents/100,
    annual: agencyBillingPlans.launch.annualPriceCents/100,
    description: "For agencies building a controlled, client-visible delivery process.",
    features: ["3 active managed client websites", "Unlimited team and client viewer accounts", "Client-first portfolio dashboard", "White-label client portal", "Opportunity and approval inbox", "Per-client service areas and budgets", "Automated audits and keyword discovery", "Client-ready reports", "Shared automation capacity", "Agency branding", "Email support"],
    cta: "Start Agency Pilot",
    href: "/login/agency?plan=launch",
    betaOffer:{price:agencyBillingPlans.launch.beta.priceCents/100,durationDays:agencyBillingPlans.launch.beta.durationDays,enrollmentLimit:agencyBillingPlans.launch.beta.enrollmentLimit,renewalPrice:agencyBillingPlans.launch.priceCents/100},
  },
  {
    slug: "agency-growth",
    audience: "agency",
    name: "Agency Growth",
    monthly: agencyBillingPlans.growth.priceCents/100,
    annual: agencyBillingPlans.growth.annualPriceCents/100,
    label: "BEST FOR GROWING AGENCIES",
    description: "For growing agencies that need pooled execution and stronger client controls.",
    features: ["Everything in Agency Launch", "8 active managed client websites", "2 Managed Scale client seats", "Portfolio-wide alerts", "Pooled execution capacity", "Bulk crawling and ranking checks", "White-label scheduled reports", "Custom client approval policies", "CMS, GitHub, and Vercel workflows", "Deployment and rollback monitoring", "Lead and revenue attribution", "API access", "Priority support"],
    cta: "Choose Agency Growth",
    href: "/login/agency?plan=growth",
    betaOffer:{price:agencyBillingPlans.growth.beta.priceCents/100,durationDays:agencyBillingPlans.growth.beta.durationDays,enrollmentLimit:agencyBillingPlans.growth.beta.enrollmentLimit,renewalPrice:agencyBillingPlans.growth.priceCents/100},
  },
  {
    slug: "agency-scale",
    audience: "agency",
    name: "Agency Scale",
    monthly: agencyBillingPlans.scale.priceCents/100,
    annual: agencyBillingPlans.scale.annualPriceCents/100,
    description: "For established agencies operating multiple brands and larger active portfolios.",
    features: ["Everything in Agency Growth", "20 active managed client websites", "5 Managed Scale client seats", "Advanced agency permissions", "Multi-brand support", "Custom report domains", "Higher automation and data limits", "Audit exports", "Advanced API access", "Dedicated onboarding", "Priority job processing", "Quarterly portfolio review"],
    cta: "Talk to Agency Sales",
    href: "/login/agency?plan=scale",
    betaOffer:{price:agencyBillingPlans.scale.beta.priceCents/100,durationDays:agencyBillingPlans.scale.beta.durationDays,enrollmentLimit:agencyBillingPlans.scale.beta.enrollmentLimit,renewalPrice:agencyBillingPlans.scale.priceCents/100},
  },
];

export const pricingAddOns = [
  ["Additional business location", "$99/month"],
  ["Additional active website", "$149/month"],
  ["Additional managed-agent action", "$15 one-time"],
  ["Human expert strategy review", "$299"],
  ["Custom migration or website integration", "Quoted before work begins"],
  ["Agency extra active client", "$79/month"],
] as const;

export const pricingFaq = [
  ["What does my subscription pay for?", "The platform, research, automation, approved implementation capacity, validation, and reporting included in your plan."],
  ["Is my monthly SEO spending budget included?", "No. Optional third-party spending is separate from your subscription and is used only after you approve it."],
  ["Will HD SEO spend money without asking?", "No. HD SEO never spends an external budget automatically. Overages and external services require approval."],
  ["Does HD SEO guarantee rankings?", "No. Rankings, leads, revenue, and profit depend on factors outside any SEO provider’s control."],
  ["What counts as a standard SEO action?", "A bounded, approved workflow such as metadata improvements, internal links, schema, a page refresh, or another plan-supported change. Larger custom projects are scoped before work starts."],
  ["Can I change plans?", "Yes. Monthly subscriptions can be changed or cancelled at the end of the billing period. Annual-plan changes are handled with the account team."],
  ["Can agencies add their own markup?", "Yes. Agencies control what they charge clients. HD SEO bills by active client website, not by user seat."],
  ["Are client and team logins included?", "Agency plans include unlimited internal team members and read-only client viewers. Business plans include access for the customer’s approved team."],
  ["Which website platforms are supported?", "Supported connections can include CMS, GitHub, and Vercel workflows. Availability depends on the platform, permissions, and configuration."],
  ["What happens if a deployment fails?", "HD SEO stops the workflow, records the failed validation, alerts the appropriate reviewer, and uses rollback protection where the connected platform supports it."],
] as const;

export type AgentServicePlan = {
  slug: string;
  audience: PricingAudience;
  name: string;
  monthly: number;
  annual?: number;
  label?: string;
  priceQualifier: string;
  foundingOffer?: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
  betaOffer: MarketingBetaOffer;
};

export const agentServicePlans: AgentServicePlan[] = [
  {
    slug: "autopilot",
    audience: "business",
    name: "Autopilot",
    monthly: retailBillingPlans.pro.priceCents/100,
    annual: retailBillingPlans.pro.annualPriceCents/100,
    label: "BEST VALUE",
    priceQualifier: "per website and primary location",
    description: "A bounded autonomous SEO team for businesses that want HD SEO to operate the approved workflow.",
    features: ["Everything in Growth Copilot", "Specialized SEO agent team", "Automatic evidence collection and opportunity selection", "Six completed customer-visible SEO actions monthly", "One major page build or comprehensive refresh monthly", "CMS or GitHub implementation through supported connections", "Preview and plain-language approval workflow", "Technical, schema, link, sitemap, robots, and deployment validation", "Rollback readiness", "Weekly monitoring", "Lead and revenue attribution", "30 minutes of human strategy review monthly"],
    cta: "Start Autopilot",
    href: "/register?plan=pro",
    betaOffer:{price:retailBillingPlans.pro.beta.priceCents/100,durationDays:retailBillingPlans.pro.beta.durationDays,enrollmentLimit:retailBillingPlans.pro.beta.enrollmentLimit,renewalPrice:retailBillingPlans.pro.priceCents/100},
  },
  {
    slug: "autopilot-plus",
    audience: "business",
    name: "Autopilot Plus",
    monthly: retailBillingPlans.autopilot_plus.priceCents/100,
    annual: retailBillingPlans.autopilot_plus.annualPriceCents/100,
    label: "HIGH-COMPETITION MARKETS",
    priceQualifier: "per website and primary location",
    description: "More execution capacity, faster review cadence, and deeper attribution for competitive or multi-location growth.",
    features: ["Everything in Autopilot", "Ten completed customer-visible SEO actions monthly", "Two major page builds or comprehensive refreshes monthly", "Priority agent execution", "Daily evidence synchronization where providers support it", "Advanced conversion, call, CRM, revenue, and gross-profit attribution", "Multi-location opportunity prioritization", "60 minutes of human strategy review monthly"],
    cta: "Start Autopilot Plus",
    href: "/register?plan=autopilot_plus",
    betaOffer:{price:retailBillingPlans.autopilot_plus.beta.priceCents/100,durationDays:retailBillingPlans.autopilot_plus.beta.durationDays,enrollmentLimit:retailBillingPlans.autopilot_plus.beta.enrollmentLimit,renewalPrice:retailBillingPlans.autopilot_plus.priceCents/100},
  },
  {
    slug: "white-label-core",
    audience: "agency",
    name: "White-Label Agent Team — Core",
    monthly: 1999,
    label: "5 MANAGED CLIENT WEBSITES",
    priceQualifier: "per month",
    foundingOffer: "Additional Core client: $299/month",
    description: "Add an autonomous, white-label SEO delivery team without adding payroll.",
    features: ["White-label agent operations", "5 managed client websites", "Unlimited agency team and client viewer accounts", "Tenant-isolated client workspaces", "Per-client budgets and permissions", "Automated opportunity discovery", "Technical and content implementation", "CMS, GitHub, and Vercel workflows", "Approval inbox", "Portfolio work queue", "Deployment and rollback monitoring", "White-label reports", "Client outcome attribution", "Pooled execution capacity", "Human escalation", "Agency-controlled pricing and markup"],
    cta: "Build My White-Label Team",
    href: "/book-demo?audience=agency&service=white-label-agents",
    betaOffer:{price:1199,durationDays:45,enrollmentLimit:3,renewalPrice:1999},
  },
  {
    slug: "white-label-scale",
    audience: "agency",
    name: "White-Label Agent Team — Scale",
    monthly: 3999,
    label: "15 MANAGED CLIENT WEBSITES",
    priceQualifier: "per month",
    foundingOffer: "Additional Scale client: $249/month",
    description: "Add an autonomous, white-label SEO delivery team without adding payroll.",
    features: ["Everything in White-Label Agent Team — Core", "15 managed client websites", "Unlimited agency team and client viewer accounts", "Tenant-isolated client workspaces", "Per-client budgets and permissions", "Automated opportunity discovery", "Technical and content implementation", "CMS, GitHub, and Vercel workflows", "Approval inbox and portfolio work queue", "Deployment and rollback monitoring", "White-label reports", "Client outcome attribution", "Expanded pooled execution capacity", "Human escalation", "Agency-controlled pricing and markup"],
    cta: "Build My White-Label Team",
    href: "/book-demo?audience=agency&service=white-label-agents",
    betaOffer:{price:2399,durationDays:45,enrollmentLimit:2,renewalPrice:3999},
  },
];

export const formatUsd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
