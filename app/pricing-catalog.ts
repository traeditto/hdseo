export type PricingAudience = "business" | "agency";
export type BillingCadence = "monthly" | "annual";

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
};

export const pricingPlans: PricingPlan[] = [
  {
    slug: "essentials",
    audience: "business",
    name: "Essentials",
    monthly: 199,
    annual: 1990,
    description: "For an owner who wants HD SEO to identify and complete the most important foundational work.",
    features: ["1 business website", "1 business location or service area", "Automated website audit", "Google Search Console and GA4 connection", "Local keyword discovery", "Competitor and content-gap research", "Up to 100 tracked keywords", "Monthly technical crawl", "Prioritized opportunity recommendations", "Two standard approved SEO actions per month", "Plain-language approval requests", "Metadata, internal-link, schema, and page-improvement workflows", "Monthly outcome report", "Email support"],
    cta: "Start With My Free Audit",
    supportingText: "No credit card required. Nothing publishes without approval.",
    href: "/audit?plan=essentials",
  },
  {
    slug: "growth",
    audience: "business",
    name: "Growth",
    monthly: 499,
    annual: 4990,
    label: "MOST POPULAR",
    description: "For an established service business that wants consistent implementation and outcome tracking.",
    features: ["Everything in Essentials", "Up to 3 locations or approved service areas", "Weekly technical crawling", "Up to 500 tracked keywords", "Daily Search Console and analytics synchronization", "Advanced competitor-gap monitoring", "Six standard approved SEO actions per month", "New service and location page workflows", "Content refreshes and conversion improvements", "Google Business Profile evidence", "CMS or GitHub publishing through supported connections", "Deployment previews", "Technical SEO and schema validation", "Lighthouse, sitemap, robots, and broken-link checks", "Rollback protection for supported connections", "Lead and conversion attribution", "Priority support"],
    cta: "Choose Growth",
    supportingText: "For businesses ready to turn SEO recommendations into consistent action.",
    href: "/audit?plan=growth",
  },
  {
    slug: "scale",
    audience: "business",
    name: "Scale",
    monthly: 999,
    annual: 9990,
    description: "For competitive markets, multi-location companies, and businesses with more than one website.",
    features: ["Everything in Growth", "Up to 3 websites", "Up to 10 locations", "Up to 1,500 tracked keywords", "Daily ranking and competitor monitoring", "Ten standard approved SEO actions per month", "Multi-location opportunity prioritization", "Advanced content clusters", "Conversion and revenue attribution", "CallRail or HubSpot integration", "Gross-profit and cost-per-qualified-lead reporting", "Custom approval and spending policies", "Priority queue access", "Quarterly strategy review", "Assisted onboarding"],
    cta: "Choose Scale",
    href: "/audit?plan=scale",
  },
  {
    slug: "agency-core",
    audience: "agency",
    name: "Agency Core",
    monthly: 499,
    annual: 4990,
    description: "For agencies building a controlled, client-visible delivery process.",
    features: ["5 active client websites", "Unlimited team and client viewer accounts", "Client-first portfolio dashboard", "White-label client portal", "Opportunity and approval inbox", "Per-client service areas and budgets", "Automated audits and keyword discovery", "Client-ready reports", "Shared automation capacity", "Agency branding", "Email support"],
    cta: "Start Agency Pilot",
    href: "/book-demo?audience=agency&plan=agency-core",
  },
  {
    slug: "agency-growth",
    audience: "agency",
    name: "Agency Growth",
    monthly: 999,
    annual: 9990,
    label: "BEST FOR GROWING AGENCIES",
    description: "For growing agencies that need pooled execution and stronger client controls.",
    features: ["Everything in Agency Core", "15 active client websites", "Portfolio-wide alerts", "Pooled execution capacity", "Bulk crawling and ranking checks", "White-label scheduled reports", "Custom client approval policies", "CMS, GitHub, and Vercel workflows", "Deployment and rollback monitoring", "Lead and revenue attribution", "API access", "Priority support"],
    cta: "Choose Agency Growth",
    href: "/book-demo?audience=agency&plan=agency-growth",
  },
  {
    slug: "agency-scale",
    audience: "agency",
    name: "Agency Scale",
    monthly: 1999,
    annual: 19990,
    description: "For established agencies operating multiple brands and larger active portfolios.",
    features: ["Everything in Agency Growth", "40 active client websites", "Advanced agency permissions", "Multi-brand support", "Custom report domains", "Higher automation and data limits", "Audit exports", "Advanced API access", "Dedicated onboarding", "Priority job processing", "Quarterly portfolio review"],
    cta: "Talk to Agency Sales",
    href: "/book-demo?audience=agency&plan=agency-scale",
  },
];

export const pricingAddOns = [
  ["Additional business location", "$99/month"],
  ["Additional active website", "$149/month"],
  ["Three additional standard SEO actions", "$299"],
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

export const formatUsd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
