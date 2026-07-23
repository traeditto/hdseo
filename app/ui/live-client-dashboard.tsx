"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { OutcomesControlCenter } from "@/app/ui/outcomes-control-center";
import { AgentServicePanel } from "@/app/ui/agent-service-panel";
import { DeploymentSetupWizard } from "@/app/ui/deployment-setup-wizard";
import { WorkReceipt } from "@/app/ui/work-receipt";
import {FOUNDING_BETA_OFFER_KEY,retailBillingPlans} from "@/lib/billing/catalog";

type User = { displayName: string; email: string };
type Client = { id: string; name: string; domain: string; status: string };
type Project = {
  id: string;
  agencyId: string;
  clientId: string;
  name: string;
  domain: string;
  status: string;
};
type Opportunity = {
  id: string;
  projectId: string;
  keyword: string;
  score: number;
  reason: string;
  status: string;
  currentRank: number | null;
  targetRank: number;
  estimatedMonthlyValue: number | null;
  targetUrl: string | null;
  confidenceScore: number;
  reasonCodes: string[];
};
type ManagedDecision = {
  kind: string;
  id: string;
  title: string;
  summary: string;
  question: string;
  riskLevel: string;
};
type ManagedOutcomeRun = {
  id: string;
  opportunity_id: string | null;
  status: string;
  current_step: string;
  failure_code: string | null;
  failure_message: string | null;
  updated_at: string;
};
type ManagedServiceStatus = {
  enrollment: { status: string; next_cycle_at?: string } | null;
  cycles: Array<{ id: string; stage: string; created_at: string; updated_at: string }>;
  escalations: Array<{ id: string; status: string; title: string; summary: string; created_at: string }>;
  activeWork: Array<{ id: string; status: string; goal: string; assigned_agent_key: string }>;
  approvals: unknown[];
  outcomeDecisions: ManagedDecision[];
  outcomeRuns: ManagedOutcomeRun[];
  summary: { nextCycleAt: string; openEscalations: number } | null;
};
type ClientPackage = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  packageData?: { metadata?: { title?: string; metaDescription?: string } };
};
type ClientEvent = {
  id: string;
  projectId: string | null;
  eventType: string;
  title: string;
  description: string | null;
  createdAt: string;
};
type GrowthProfile = {
  clientId: string;
  projectId: string;
  onboardingStatus: string;
  onboardingStep: number;
  businessGoal: string;
  services: string[];
  serviceAreas: string[];
  marketScope: "service_area" | "nationwide";
  priorityServices: string[];
  idealCustomer: string | null;
  averageCustomerValue: number | null;
  monthlyBudget: number;
  automationLevel: "recommend" | "safe" | "concierge";
  notificationPreferences: Record<string, boolean>;
};
type Subscription = {
  projectId: string;
  planKey: "free_audit" | "starter" | "growth" | "pro" | "autopilot_plus";
  status: string;
  billingInterval: string;
  priceCents: number;
  offerKey: string | null;
  offerPriceCents: number | null;
  offerEndsAt: string | null;
  betaRedeemedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};
type TrialEntitlement = {
  projectId: string;
  benefitKey: "website_crawl";
  allowance: number;
  usedCount: number;
  remaining: number;
  status: "active" | "exhausted" | "expired" | "converted";
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageStatus: "claimed" | "queued" | "succeeded" | "failed" | null;
};
type Website = {
  id: string;
  projectId: string;
  siteUrl: string;
  cmsType: string;
  status: string;
  lastVerifiedAt: string | null;
  connectionMode: string | null;
  connectionStatus: string | null;
  editorMode: string | null;
  publishingReady: boolean;
  publishingBlockers: string[];
  connectionInvite: {
    status: string;
    recipientEmail: string | null;
    expiresAt: string;
    firstOpenedAt: string | null;
    completedAt: string | null;
  } | null;
};
type Integration = {
  projectId: string;
  provider: string;
  status: string;
  lastSyncedAt: string | null;
};
type AgentWork = {
  id: string;
  projectId: string;
  agentKey: string;
  goal: string;
  status: string;
  spentAmount: number;
  updatedAt: string;
};
type Outcome = {
  projectId: string;
  clicks: number;
  impressions: number;
  leads: number;
  qualifiedLeads: number;
  recordedRevenue: number;
  recordedGrossProfit: number;
};
type SupportRequest = {
  id: string;
  projectId: string;
  category: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
};
type ClientData = {
  clients: Array<{ client: Client; role: string }>;
  projects: Project[];
  opportunities: Opportunity[];
  packages: ClientPackage[];
  events: ClientEvent[];
  growthProfiles: GrowthProfile[];
  subscriptions: Subscription[];
  trialEntitlements: TrialEntitlement[];
  websites: Website[];
  integrations: Integration[];
  agentWork: AgentWork[];
  outcomes: Outcome[];
  supportRequests: SupportRequest[];
};
type Tab = "home" | "autopilot" | "plan" | "approvals" | "results" | "business";

const awaitingStatuses = new Set(["client_review", "awaiting_client"]);
const completedStatuses = new Set([
  "implemented",
  "implemented_unverified",
  "verified",
]);
const managedActiveStatuses = new Set([
  "reserved",
  "analyzing",
  "awaiting_approval",
  "implementing",
  "preview",
  "qa",
  "publishing",
  "monitoring",
]);
const blockedOpportunityReasons = new Set([
  "ACTIVE_DUPLICATE",
  "CONFIDENCE_BELOW_THRESHOLD",
  "COOLDOWN_ACTIVE",
  "LOCATION_EXCLUDED",
  "MARKET_SCOPE_MISMATCH",
  "NO_EXPECTED_BUSINESS_VALUE",
  "PAGE_OWNERSHIP_CONFLICT",
  "PAYBACK_EXCEEDS_AUTOPILOT_LIMIT",
  "VALUE_BELOW_PLAN_THRESHOLD",
  "CUSTOMER_PLAN_ROI_BELOW_THRESHOLD",
  "PAYBACK_EXCEEDS_FOCUS_LIMIT",
  "TWELVE_MONTH_ROI_BELOW_THRESHOLD",
  "RANKING_DISTANCE_EXCEEDS_FOCUS_RANGE",
  "ECONOMIC_EVIDENCE_INCOMPLETE",
  "QUERY_TOO_BROAD",
  "QUERY_TOO_LONG",
  "REDUNDANT_QUERY",
  "REQUIRED_EVIDENCE_MISSING",
  "SERVICE_CAPACITY_UNAVAILABLE",
  "SERVICE_NOT_VERIFIED",
]);
const managedStepLabels: Record<string, string> = {
  reservation: "reserving the best qualified move",
  evidence: "checking search and business evidence",
  research: "researching the opportunity",
  strategy: "building the safest plan",
  creative: "preparing the exact content",
  implementation: "preparing the exact website change",
  preview: "building and checking a protected preview",
  qa: "running safety and SEO checks",
  publishing: "publishing the approved change",
  monitoring: "measuring rankings, traffic, and leads",
};
const agentNames: Record<string, string> = {
  onboarding: "Onboarding Agent",
  research: "Research Agent",
  strategy: "Strategy Agent",
  technical_seo: "Technical SEO Agent",
  content: "Content Agent",
  local_seo: "Local SEO Agent",
  implementation: "Implementation Agent",
  qa: "QA Agent",
  reporting: "Reporting Agent",
  supervisor: "Supervisor Agent",
};
const goalLabels: Record<string, string> = {
  more_qualified_leads: "More qualified leads",
  more_calls: "More phone calls",
  more_bookings: "More bookings",
  more_store_visits: "More store visits",
  more_sales: "More online sales",
  build_visibility: "Build local visibility",
};
const planLabels: Record<string, string> = {
  free_audit: "Free Audit",
  starter: "Essentials",
  growth: "Growth Copilot",
  pro: "Autopilot",
  autopilot_plus: "Autopilot Plus",
};
const splitList = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
const friendlyStatus = (status: string) =>
  status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

type PostActionResult = {
  data: ClientData;
  message?: string;
  handoff?: { id: string; url: string; expiresAt: string; delivery: "sent" | "manual" | "failed" };
};

async function postAction(body: Record<string, unknown>) {
  const response = await fetch("/api/live", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "HD SEO could not complete that action.",
    );
  return result as PostActionResult;
}

function Brand() {
  return (
    <Link className="role-brand" href="/">
      <span className="login-mark">
        <i />
        <b />
      </span>
      <span>
        HD <em>SEO</em>
      </span>
    </Link>
  );
}

function TrialPreviewNotice({area}:{area:string}) {
  return <div className="owner-trial-preview-note"><span>PREVIEW MODE</span><p>You can explore {area}. Actions that create provider cost, publish changes, or start ongoing agents require a paid plan.</p><Link href="/pricing">Compare plans →</Link></div>;
}

function TrialAutopilotPreview() {
  return <>
    <section className="owner-page-heading"><small>AUTOPILOT PREVIEW</small><h1>See how the agent team would work.</h1><p>The free trial demonstrates the workflow without starting paid research, content generation, or publishing.</p></section>
    <TrialPreviewNotice area="the managed agent workspace" />
    <section className="owner-trial-feature-grid">
      {[
        ["Research Agent","Finds service-area keywords and competitor gaps automatically."],
        ["Strategy Agent","Prioritizes work by expected profit, evidence, effort, and risk."],
        ["Implementation Agent","Prepares approval-gated CMS or GitHub changes."],
        ["QA Agent","Checks links, schema, Lighthouse, sitemap, robots, and rollback readiness."],
      ].map(([title,detail])=><article key={title}><i>✓</i><div><strong>{title}</strong><p>{detail}</p></div><span>PAID PLAN</span></article>)}
    </section>
    <section className="owner-trial-upgrade"><div><small>NO SURPRISE SPEND</small><h2>Choose ongoing automation only after you see the crawl.</h2><p>Subscriptions include bounded agent actions. Extra provider spend stays behind explicit controls and approvals.</p></div><Link href="/pricing">See business plans →</Link></section>
  </>;
}

function RetailOnboarding({
  user,
  onComplete,
}: {
  user: User;
  onComplete: (data: ClientData) => void;
}) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({
    businessName: "",
    domain: "",
    phone: "",
    services: "",
    serviceAreas: "",
    marketScope: "service_area",
    priorityServices: "",
    idealCustomer: "",
    averageCustomerValue: "",
    monthlyBudget: "99",
    automationLevel: "safe",
  });
  const update = (key: string, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const services = splitList(draft.services);

  async function finish() {
    setBusy(true);
    setMessage("");
    try {
      const result = await postAction({
        action: "retail_create_business",
        businessName: draft.businessName,
        domain: draft.domain,
        phone: draft.phone,
        services,
        serviceAreas: splitList(draft.serviceAreas),
        marketScope: draft.marketScope,
        priorityServices: splitList(draft.priorityServices),
        idealCustomer: draft.idealCustomer,
        averageCustomerValue: draft.averageCustomerValue
          ? Number(draft.averageCustomerValue)
          : undefined,
        monthlyBudget: Number(draft.monthlyBudget),
        automationLevel: draft.automationLevel,
      });
      onComplete(result.data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Your business could not be added.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="owner-onboarding-page">
      <header>
        <Brand />
        <div>
          <span>{user.displayName}</span>
          <a href="/api/auth/signout">Sign out</a>
        </div>
      </header>
      <section className="owner-onboarding-shell">
        <aside>
          <small>GET STARTED</small>
          <h1>Your local growth employee.</h1>
          <p>
            Tell us about the business. HD SEO will find the searches,
            competitors and work worth doing—you will not need to learn SEO.
            Your free trial includes one public crawl of up to 25 pages.
          </p>
          <ol>
            {[
              "Your business",
              "Services and area",
              "Best customers",
              "Control and safety",
            ].map((label, index) => (
              <li
                className={
                  step === index + 1 ? "active" : step > index + 1 ? "done" : ""
                }
                key={label}
              >
                <i>{step > index + 1 ? "✓" : index + 1}</i>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </aside>
        <div className="owner-onboarding-card">
          <div className="owner-step-progress">
            <span style={{ width: `${step * 25}%` }} />
          </div>
          <div className="owner-trial-promise">
            <b>Free trial · no credit card</b>
            <span>One 25-page website crawl, full product tour, and no publishing or paid data charges.</span>
          </div>
          {step === 1 && (
            <>
              <small>STEP 1 OF 4</small>
              <h2>Which business should HD SEO grow?</h2>
              <p>
                We will safely inspect the public website and pre-detect its
                platform. No password is needed.
              </p>
              <label>
                Business name
                <input
                  value={draft.businessName}
                  onChange={(event) =>
                    update("businessName", event.target.value)
                  }
                  placeholder="Kingdom Roofing"
                  autoFocus
                />
              </label>
              <label>
                Website address
                <input
                  value={draft.domain}
                  onChange={(event) => update("domain", event.target.value)}
                  placeholder="yourbusiness.com"
                  inputMode="url"
                />
              </label>
              <label>
                Best phone number <em>optional</em>
                <input
                  value={draft.phone}
                  onChange={(event) => update("phone", event.target.value)}
                  placeholder="(555) 555-0123"
                  inputMode="tel"
                />
              </label>
            </>
          )}
          {step === 2 && (
            <>
              <small>STEP 2 OF 4</small>
              <h2>What do you sell, and where?</h2>
              <p>
                Use everyday language. HD SEO will discover the relevant
                searches automatically.
              </p>
              <label>
                Services you want customers to find
                <textarea
                  value={draft.services}
                  onChange={(event) => update("services", event.target.value)}
                  placeholder="Roof replacement, roof repair, storm damage\nSeparate services with commas or new lines"
                  autoFocus
                />
              </label>
              <div className="owner-control-options owner-market-options">
                {[
                  [
                    "service_area",
                    "Specific service areas",
                    "For contractors, stores, and services tied to cities or regions.",
                  ],
                  [
                    "nationwide",
                    "Nationwide",
                    "For ecommerce, software, and services available throughout the country.",
                  ],
                ].map(([value, title, detail]) => (
                  <button
                    type="button"
                    className={draft.marketScope === value ? "active" : ""}
                    onClick={() => update("marketScope", value)}
                    key={value}
                  >
                    <i>{draft.marketScope === value ? "✓" : ""}</i>
                    <span>
                      <b>{title}</b>
                      <small>{detail}</small>
                    </span>
                  </button>
                ))}
              </div>
              {draft.marketScope === "service_area" && (
                <label>
                  Cities or service areas
                  <textarea
                    value={draft.serviceAreas}
                    onChange={(event) =>
                      update("serviceAreas", event.target.value)
                    }
                    placeholder="Jacksonville, Orange Park, St. Augustine"
                  />
                </label>
              )}
              <div className="owner-no-keywords">
                <b>No keywords required.</b>
                <span>
                  {draft.marketScope === "nationwide"
                    ? "We will evaluate demand throughout the United States."
                    : "We use the website and selected service areas to keep searches geographically relevant."}
                </span>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <small>STEP 3 OF 4</small>
              <h2>Which customers are most valuable?</h2>
              <p>
                This keeps HD SEO focused on profitable work—not empty traffic.
              </p>
              <label>
                Highest-priority services
                <textarea
                  value={draft.priorityServices}
                  onChange={(event) =>
                    update("priorityServices", event.target.value)
                  }
                  placeholder={
                    services.slice(0, 3).join(", ") ||
                    "Roof replacement, commercial roofing"
                  }
                  autoFocus
                />
              </label>
              <label>
                Your ideal customer <em>optional</em>
                <textarea
                  value={draft.idealCustomer}
                  onChange={(event) =>
                    update("idealCustomer", event.target.value)
                  }
                  placeholder="A homeowner in our service area who needs a full replacement within 30 days"
                />
              </label>
              <label>
                Approximate value of a new customer <em>optional</em>
                <span className="owner-money-input">
                  <b>$</b>
                  <input
                    value={draft.averageCustomerValue}
                    onChange={(event) =>
                      update("averageCustomerValue", event.target.value)
                    }
                    inputMode="decimal"
                    placeholder="12000"
                  />
                </span>
              </label>
            </>
          )}
          {step === 4 && (
            <>
              <small>STEP 4 OF 4</small>
              <h2>How much control do you want?</h2>
              <p>
                DNS, pricing, legal claims and destructive changes always
                require approval.
              </p>
              <div className="owner-control-options">
                {[
                  [
                    "recommend",
                    "Recommend",
                    "HD SEO prepares work. You approve every change.",
                  ],
                  [
                    "safe",
                    "Safe Autopilot",
                    "Low-risk improvements can proceed. Important changes pause for you.",
                  ],
                  [
                    "concierge",
                    "Human-reviewed",
                    "HD SEO prepares the work and a specialist reviews it with you.",
                  ],
                ].map(([value, title, detail]) => (
                  <button
                    type="button"
                    className={draft.automationLevel === value ? "active" : ""}
                    onClick={() => update("automationLevel", value)}
                    key={value}
                  >
                    <i>{draft.automationLevel === value ? "✓" : ""}</i>
                    <span>
                      <b>{title}</b>
                      <small>{detail}</small>
                    </span>
                  </button>
                ))}
              </div>
              <label>
                Future monthly growth budget
                <input
                  value={draft.monthlyBudget}
                  onChange={(event) =>
                    update("monthlyBudget", event.target.value)
                  }
                  type="number"
                  min="0"
                  step="10"
                />
                <em>
                  Nothing is charged during the free trial. If you later choose
                  a plan, this becomes a spending guardrail—not permission for
                  unrestricted charges.
                </em>
              </label>
              <div className="owner-safety-note">
                <b>Always protected</b>
                <span>
                  Tenant isolation · Spending limits · Approval gates · Audit
                  history · Bounded retries · Rollback readiness
                </span>
              </div>
            </>
          )}
          {message && (
            <div className="owner-error" role="alert">
              {message}
            </div>
          )}
          <footer>
            {step > 1 ? (
              <button onClick={() => setStep((value) => value - 1)}>
                ← Back
              </button>
            ) : (
              <span />
            )}
            <button
              className="primary"
              disabled={
                busy ||
                (step === 1 && (!draft.businessName || !draft.domain)) ||
                (step === 2 &&
                  (!services.length ||
                    (draft.marketScope === "service_area" &&
                      !splitList(draft.serviceAreas).length)))
              }
              onClick={() =>
                step < 4 ? setStep((value) => value + 1) : void finish()
              }
            >
              {busy
                ? "Creating your workspace…"
                : step < 4
                  ? "Continue →"
                  : "Create my free trial workspace →"}
            </button>
          </footer>
        </div>
      </section>
    </main>
  );
}

export function LiveClientBusinessDashboard({
  initialData,
  user,
}: {
  initialData: ClientData;
  user: User;
}) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>("home");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [managedDecisionCount, setManagedDecisionCount] = useState(0);
  const [managedService, setManagedService] = useState<ManagedServiceStatus | null>(null);
  const [deploymentSetupProject, setDeploymentSetupProject] = useState<Project | null>(null);
  const [receiptPackageId, setReceiptPackageId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState(
    initialData.clients[0]?.client.id ?? "",
  );
  const selectedAccess =
    data.clients.find((item) => item.client.id === selectedClientId) ??
    data.clients[0];
  const selectedClient = selectedAccess?.client;
  const canApprove = selectedAccess
    ? ["client_admin", "client_approver"].includes(selectedAccess.role)
    : false;

  const company = useMemo(() => {
    const projects = data.projects.filter(
        (item) => item.clientId === selectedClient?.id,
      ),
      projectIds = new Set(projects.map((item) => item.id));
    const opportunities = data.opportunities
      .filter((item) => projectIds.has(item.projectId))
      .sort((a, b) => b.score - a.score);
    return {
      projects,
      projectIds,
      opportunities,
      packages: data.packages.filter((item) => projectIds.has(item.projectId)),
      events: data.events.filter(
        (item) => item.projectId === null || projectIds.has(item.projectId),
      ),
      profiles: data.growthProfiles.filter((item) =>
        projectIds.has(item.projectId),
      ),
      subscriptions: data.subscriptions.filter((item) =>
        projectIds.has(item.projectId),
      ),
      trialEntitlements: (data.trialEntitlements ?? []).filter((item) =>
        projectIds.has(item.projectId),
      ),
      websites: data.websites.filter((item) => projectIds.has(item.projectId)),
      integrations: data.integrations.filter((item) =>
        projectIds.has(item.projectId),
      ),
      agentWork: data.agentWork.filter((item) =>
        projectIds.has(item.projectId),
      ),
      outcomes: data.outcomes.filter((item) => projectIds.has(item.projectId)),
      supportRequests: data.supportRequests.filter((item) =>
        projectIds.has(item.projectId),
      ),
    };
  }, [data, selectedClient?.id]);
  const project = company.projects[0],
    profile = company.profiles.find((item) => item.projectId === project?.id),
    subscription = company.subscriptions.find(
      (item) => item.projectId === project?.id,
    ),
    trialEntitlement = company.trialEntitlements.find(
      (item) => item.projectId === project?.id && item.benefitKey === "website_crawl",
    ),
    isFreeTrial = subscription?.planKey === "free_audit",
    trialExpired = isFreeTrial && trialEntitlement?.status === "expired",
    trialCrawlAvailable = isFreeTrial && !trialExpired && trialEntitlement?.status === "active" && (trialEntitlement?.remaining ?? 0) > 0,
    trialCrawlFinished = trialEntitlement?.usageStatus === "succeeded",
    outcome = company.outcomes.find(
      (item) => item.projectId === project?.id,
    ) ?? {
      clicks: 0,
      impressions: 0,
      leads: 0,
      qualifiedLeads: 0,
      recordedRevenue: 0,
      recordedGrossProfit: 0,
      projectId: project?.id ?? "",
    };
  const approvals = company.packages.filter((item) =>
      awaitingStatuses.has(item.status),
    ),
    completed = company.packages.filter((item) =>
      completedStatuses.has(item.status),
    );
  const evidenceBlocked = company.agentWork.some(
    (item) =>
      item.status === "blocked" &&
      ["research", "strategy"].includes(item.agentKey),
  );
  const gsc = company.integrations.find(
      (item) =>
        item.provider === "google_search_console" && item.status === "active",
    ),
    website = company.websites[0];
  const websitePublishingReady = website?.publishingReady === true;
  const websiteSetupPending =
    website?.connectionMode === "managed_migration" &&
    website.connectionStatus === "pending";

  useEffect(() => {
    if (!project?.id || isFreeTrial) {
      return;
    }
    let active = true;
    const load = () =>
      fetch(`/api/agent-service/status?projectId=${encodeURIComponent(project.id)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Managed SEO status could not be loaded.");
          return response.json() as Promise<{service?:ManagedServiceStatus}>;
        })
        .then((payload) => {
          if (!active) return;
          const service = payload.service ?? null;
          setManagedService(service);
          setManagedDecisionCount(
            (service?.approvals?.length ?? 0) +
              (service?.outcomeDecisions?.length ?? 0),
          );
        })
        .catch(() => {
          if (!active) return;
          setManagedService(null);
          setManagedDecisionCount(0);
        });
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [project?.id, isFreeTrial]);

  const effectiveManagedDecisionCount = !project?.id || isFreeTrial ? 0 : managedDecisionCount;
  const effectiveManagedService = !project?.id || isFreeTrial ? null : managedService;
  const managedDecision = effectiveManagedService?.outcomeDecisions?.[0] ?? null;
  const latestManagedRun = effectiveManagedService?.outcomeRuns?.[0] ?? null;
  const latestManagedCycle = effectiveManagedService?.cycles?.[0] ?? null;
  const recoveryStarted =
    latestManagedRun?.status === "failed" &&
    latestManagedCycle &&
    new Date(latestManagedCycle.created_at).getTime() >
      new Date(latestManagedRun.updated_at).getTime();
  const activeManagedRun =
    latestManagedRun && managedActiveStatuses.has(latestManagedRun.status)
      ? latestManagedRun
      : null;
  const managedOpenEscalation =
    recoveryStarted
      ? null
      : effectiveManagedService?.escalations?.find((item) =>
          ["open", "in_progress", "waiting"].includes(item.status),
        ) ?? null;
  const managedFailure =
    latestManagedRun?.status === "failed" && !recoveryStarted
      ? latestManagedRun
      : null;
  const executableOpportunities = company.opportunities.filter(
    (item) =>
      item.targetUrl &&
      item.score >= 55 &&
      item.confidenceScore >= 55 &&
      !item.reasonCodes.some((reason) => blockedOpportunityReasons.has(reason)),
  );
  const activeOpportunity = activeManagedRun?.opportunity_id
    ? company.opportunities.find(
        (item) => item.id === activeManagedRun.opportunity_id,
      ) ?? null
    : null;
  const topOpportunity = activeOpportunity ?? executableOpportunities[0] ?? null;
  const managedStep =
    managedStepLabels[activeManagedRun?.current_step ?? ""] ??
    (activeManagedRun
      ? friendlyStatus(activeManagedRun.current_step)
      : "researching the next qualified move");

  if (!data.clients.length)
    return (
      <RetailOnboarding
        user={user}
        onComplete={(next) => {
          setData(next);
          setSelectedClientId(next.clients[0]?.client.id ?? "");
          setMessage("Your business workspace is ready.");
        }}
      />
    );

  async function act(body: Record<string, unknown>, success?: string): Promise<PostActionResult | null> {
    setBusyId(String(body.packageId ?? body.action));
    setMessage("");
    try {
      const result = await postAction(body);
      setData(result.data);
      setMessage(result.message ?? success ?? "Saved.");
      return result;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The action could not be completed.",
      );
      return null;
    } finally {
      setBusyId(null);
    }
  }
  async function decide(packageId: string, decision: string) {
    const result = await act(
      { action: "package_decision", packageId, decision },
      decision === "client_approved"
        ? "Approved. HD SEO can continue."
        : "Your feedback was sent.",
    );
    if (result && decision === "client_approved") setReceiptPackageId(packageId);
  }

  function openWebsiteSetup() {
    setTab("business");
    window.setTimeout(() => {
      document
        .getElementById("owner-website-setup")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  const nav: Array<[Tab, string, string]> = [
    ["home", "Home", "⌂"],
    ["autopilot", "Autopilot", "✦"],
    ["plan", "My Plan", "◫"],
    ["approvals", "Approvals", String(approvals.length+effectiveManagedDecisionCount)],
    ["results", "Results", "↗"],
    ["business", "My Business", "◎"],
  ];
  const statusTitle = isFreeTrial
    ? trialExpired
      ? "Your free trial has ended"
      : trialCrawlAvailable
      ? "Your free website crawl is ready"
      : trialCrawlFinished
        ? "Your free website crawl is complete"
        : "Your free website crawl is in progress"
    : approvals.length+effectiveManagedDecisionCount>0
    ? "We need one quick decision"
    : activeManagedRun
      ? "Autopilot is moving your plan forward"
    : managedFailure || managedOpenEscalation
      ? "HD SEO protected your website"
    : evidenceBlocked
      ? "Research needs a safe restart"
    : profile?.onboardingStatus !== "active"
      ? "Finish setup to start growing"
      : company.agentWork.length
        ? "HD SEO is working for you"
        : "Your growth plan is on track";
  const statusText = isFreeTrial
    ? trialExpired
      ? "Your workspace is still here. Choose a plan to run fresh evidence collection and start ongoing SEO work."
      : trialCrawlAvailable
      ? "Run one public crawl of up to 25 pages, then explore how HD SEO turns evidence into plans, approvals, and measurable results."
      : trialCrawlFinished
        ? "Explore your results and the full workspace. Ongoing crawling, paid data, agents, and publishing stay off until you choose a plan."
        : "The crawl is queued safely. You can explore every product area while the worker collects public website evidence."
    : approvals.length+effectiveManagedDecisionCount>0
    ? "Autopilot has already done the research and preparation. Review the one customer-visible safety decision so it can continue."
    : activeManagedRun
      ? `No action is needed. HD SEO is ${managedStep} and will continue automatically through its next safe stage.`
    : managedFailure || managedOpenEscalation
      ? "A proposed change did not pass a protected check. The previous safe version stayed live, and Autopilot is excluding that move before researching another."
    : evidenceBlocked
      ? "The first keyword evidence run did not start correctly. Restarting will collect it before the strategy is built."
    : profile?.onboardingStatus !== "active"
      ? "Confirm your connections, then let the agent team begin the first local audit."
      : company.agentWork.length
        ? `${company.agentWork.length} agent task${company.agentWork.length === 1 ? " is" : "s are"} researching, planning or validating work.`
        : "Nothing needs your attention right now.";

  return (
    <>
    <main className="owner-portal">
      <aside className="owner-sidebar">
        <Brand />
        <div className="owner-business-card">
          <small>YOUR BUSINESS</small>
          <strong>{selectedClient?.name}</strong>
          <span>{selectedClient?.domain}</span>
        </div>
        {data.clients.length > 1 && (
          <select
            value={selectedClient?.id}
            onChange={(event) => setSelectedClientId(event.target.value)}
          >
            {data.clients.map((item) => (
              <option value={item.client.id} key={item.client.id}>
                {item.client.name}
              </option>
            ))}
          </select>
        )}
        <nav>
          {nav.map(([key, label, badge]) => (
            <button
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
              key={key}
            >
              <i>{badge}</i>
              <span>{label}</span>
              {key === "approvals" && approvals.length > 0 && (
                <b>{approvals.length}</b>
              )}
              {key === "business" && !isFreeTrial && !websitePublishingReady && (
                <b className="owner-nav-alert" aria-label="Website setup needed">!</b>
              )}
            </button>
          ))}
        </nav>
        <div className="owner-sidebar-help">
          <small>NEED HELP?</small>
          <p>
            Ask in plain language. Your business context is included
            automatically.
          </p>
          <button onClick={() => setTab("business")}>Ask HD SEO →</button>
        </div>
        <footer>
          <span>{user.displayName}</span>
          <small>{user.email}</small>
          <a href="/api/auth/signout">Sign out</a>
        </footer>
      </aside>
      <section className="owner-main">
        <header className="owner-topbar">
          <div>
            <small>BUSINESS OWNER PORTAL</small>
            <strong>{nav.find(([key]) => key === tab)?.[1]}</strong>
          </div>
          <div>
            <span className={approvals.length || (!isFreeTrial && !websitePublishingReady) ? "attention" : ""}>
              {approvals.length
                ? `${approvals.length} decision${approvals.length === 1 ? "" : "s"} waiting`
                : !isFreeTrial && !websitePublishingReady
                  ? "Website setup needed"
                : "You’re all set"}
            </span>
            <button onClick={() => setTab("business")}>Ask HD SEO</button>
          </div>
        </header>
        <div className="owner-content">
          {isFreeTrial && (
            <section className="owner-trial-banner" aria-label="Free trial status">
              <span>FREE TRIAL</span>
              <div>
                <strong>{trialExpired ? "Free trial ended" : trialCrawlAvailable ? "1 website crawl ready" : trialCrawlFinished ? "Free crawl complete" : "Free crawl queued"}</strong>
                <small>Explore the full UI. Paid keyword data, ongoing agents, publishing, and external spend remain locked.</small>
              </div>
              <button onClick={() => setTab("business")}>{trialCrawlAvailable ? "Trial details" : "Compare plans"}</button>
            </section>
          )}
          {message && (
            <div className="owner-flash" role="status">
              {message}
            </div>
          )}
          {tab === "home" && (
            <>
              {!isFreeTrial && !websitePublishingReady && (
                <section
                  className={`owner-website-alert ${websiteSetupPending ? "pending" : ""}`}
                  role="alert"
                  aria-labelledby="website-setup-alert-title"
                >
                  <span aria-hidden="true">!</span>
                  <div>
                    <small>{websiteSetupPending ? "SETUP REQUESTED" : "NEEDS YOUR ATTENTION"}</small>
                    <h2 id="website-setup-alert-title">
                      {websiteSetupPending
                        ? "HD SEO is preparing your website connection"
                        : "Finish connecting your website"}
                    </h2>
                    <p>
                      {websiteSetupPending
                        ? "Your site can already be analyzed. We’ll keep this task visible until publishing access has been verified."
                        : `HD SEO can analyze ${project?.domain ?? "your website"}, but it cannot publish approved improvements yet. We detected ${friendlyStatus(website?.cmsType ?? "unknown")} and will walk you through the matching one-time setup.`}
                    </p>
                  </div>
                  <button type="button" onClick={openWebsiteSetup}>
                    {websiteSetupPending ? "View setup status →" : "Connect my website →"}
                  </button>
                </section>
              )}
              <section
                className={`owner-status-hero ${!isFreeTrial && approvals.length ? "attention" : ""}`}
              >
                <div>
                  <small>
                    {isFreeTrial ? "ONE-TIME FREE TRIAL" : approvals.length ? "ABOUT 2 MINUTES" : "TODAY"}
                  </small>
                  <h1>{statusTitle}</h1>
                  <p>{statusText}</p>
                </div>
                {isFreeTrial ? (
                  trialCrawlAvailable && project ? (
                    <button disabled={busyId === "retail_activate"} onClick={() => void act({action:"retail_activate",projectId:project.id})}>
                      {busyId === "retail_activate" ? "Queueing your crawl…" : "Run my free 25-page crawl →"}
                    </button>
                  ) : (
                    <button onClick={() => setTab("results")}>Explore the results workspace →</button>
                  )
                ) : approvals.length + effectiveManagedDecisionCount > 0 ? (
                  <button onClick={() => setTab("approvals")}>
                    Review the decision →
                  </button>
                ) : evidenceBlocked && project ? (
                  <button
                    disabled={busyId === "retail_activate"}
                    onClick={() =>
                      void act({
                        action: "retail_activate",
                        projectId: project.id,
                      })
                    }
                  >
                    {busyId === "retail_activate"
                      ? "Restarting research…"
                      : "Resume my agent team →"}
                  </button>
                ) : profile?.onboardingStatus !== "active" && project ? (
                  <button
                    disabled={busyId === "retail_activate"}
                    onClick={() =>
                      void act({
                        action: "retail_activate",
                        projectId: project.id,
                      })
                    }
                  >
                    {busyId === "retail_activate"
                      ? "Starting…"
                      : "Start my agent team →"}
                  </button>
                ) : (
                  <span className="owner-working-pulse">
                    <i /> Working safely
                  </span>
                )}
              </section>
              <section className="owner-outcome-grid">
                <article>
                  <small>LEADS RECORDED</small>
                  <strong>{outcome.leads}</strong>
                  <span>{outcome.qualifiedLeads} marked qualified</span>
                </article>
                <article>
                  <small>VISITS FROM GOOGLE</small>
                  <strong>{outcome.clicks.toLocaleString()}</strong>
                  <span>Last 90 days of connected data</span>
                </article>
                <article>
                  <small>WORK COMPLETED</small>
                  <strong>{completed.length}</strong>
                  <span>Published or independently checked</span>
                </article>
                <article>
                  <small>VALUE RECORDED</small>
                  <strong>{money(outcome.recordedGrossProfit)}</strong>
                  <span>Gross profit with supporting lead data</span>
                </article>
              </section>
              <div className="owner-home-grid">
                <section className="owner-next-card">
                  <header>
                    <small>BEST NEXT MOVE</small>
                    <span>
                      {managedDecision
                        ? "Your approval"
                        : activeManagedRun
                          ? "Autopilot working"
                          : managedFailure || managedOpenEscalation
                            ? "Protected"
                            : topOpportunity
                              ? "Starting automatically"
                              : "Researching"}
                    </span>
                  </header>
                  {managedDecision ? (
                    <>
                      <h2>{managedDecision.title}</h2>
                      <p>{managedDecision.summary}</p>
                      <div className="owner-why">
                        <b>Why you are seeing this</b>
                        <span>
                          Autopilot handles research, preparation, previews, QA,
                          publishing, and monitoring. It pauses only before a
                          customer-visible or high-risk decision.
                        </span>
                      </div>
                      <button onClick={() => setTab("approvals")}>
                        Review the exact change →
                      </button>
                    </>
                  ) : activeManagedRun ? (
                    <>
                      <h2>Autopilot is {managedStep}</h2>
                      <p>
                        No action is needed. HD SEO will advance this work,
                        retry temporary failures, validate every change, and
                        stop only if a real business decision needs you.
                      </p>
                      {topOpportunity && (
                        <details>
                          <summary>Show the opportunity being worked</summary>
                          <p>
                            Target search: <strong>{topOpportunity.keyword}</strong>
                          </p>
                          <p>
                            Target page: <strong>{topOpportunity.targetUrl}</strong>
                          </p>
                        </details>
                      )}
                      <button onClick={() => setTab("autopilot")}>
                        See live Autopilot status →
                      </button>
                    </>
                  ) : managedFailure || managedOpenEscalation ? (
                    <>
                      <h2>The previous safe version stayed live</h2>
                      <p>
                        A proposed move did not pass HD SEO&apos;s protected
                        checks. It was not counted as completed work, and
                        Autopilot is excluding it before choosing another.
                      </p>
                      <div className="owner-why">
                        <b>No action required</b>
                        <span>
                          This is a safety record, not SEO homework. Temporary
                          failures retry automatically; unsafe opportunities
                          are cooled down and replaced.
                        </span>
                      </div>
                      <button onClick={() => setTab("autopilot")}>
                        View the safety record →
                      </button>
                    </>
                  ) : topOpportunity ? (
                    <>
                      <h2>
                        Autopilot is preparing: {topOpportunity.keyword}
                      </h2>
                      <p>
                        {topOpportunity.reason ||
                          `HD SEO found a valuable customer search connected to ${topOpportunity.keyword}.`}
                      </p>
                      <div className="owner-why">
                        <b>Why now</b>
                        <span>
                          It fits your services and {profile?.marketScope === "nationwide" ? "nationwide market" : "verified service area"}, and scored above other available work.
                        </span>
                      </div>
                      {topOpportunity.estimatedMonthlyValue != null && (
                        <div className="owner-why">
                          <b>Expected value</b>
                          <span>
                            About {money(topOpportunity.estimatedMonthlyValue)} in monthly gross profit if the measured lift and recorded business assumptions hold. This is a directional estimate, not a guarantee.
                          </span>
                        </div>
                      )}
                      <details>
                        <summary>Show the search evidence</summary>
                        <p>
                          People search for:{" "}
                          <strong>{topOpportunity.keyword}</strong>
                        </p>
                        {topOpportunity.currentRank && (
                          <p>
                            Your current observed position: approximately{" "}
                            {topOpportunity.currentRank}
                          </p>
                        )}
                      </details>
                      <button onClick={() => setTab("plan")}>
                        See why Autopilot selected this →
                      </button>
                    </>
                  ) : (
                    <div className="owner-empty">
                      <i>◎</i>
                      <strong>Research is being prepared</strong>
                      <p>
                        HD SEO will place the most useful next action here—not a
                        long list of SEO homework.
                      </p>
                    </div>
                  )}
                </section>
                <section className="owner-now-card">
                  <header>
                    <small>WHAT HD SEO IS DOING</small>
                    <button onClick={() => setTab("plan")}>Full plan</button>
                  </header>
                  {company.agentWork.length ? (
                    company.agentWork.slice(0, 5).map((item) => (
                      <article key={item.id}>
                        <i className={item.status} />
                        <div>
                          <strong>
                            {agentNames[item.agentKey] ??
                              friendlyStatus(item.agentKey)}
                          </strong>
                          <p>{item.goal}</p>
                        </div>
                        <span>{friendlyStatus(item.status)}</span>
                      </article>
                    ))
                  ) : activeManagedRun ? (
                    <article>
                      <i className={activeManagedRun.status} />
                      <div>
                        <strong>Supervisor Agent</strong>
                        <p>HD SEO is {managedStep}.</p>
                      </div>
                      <span>{friendlyStatus(activeManagedRun.status)}</span>
                    </article>
                  ) : managedFailure || managedOpenEscalation ? (
                    <article>
                      <i className="blocked" />
                      <div>
                        <strong>Protected recovery</strong>
                        <p>
                          {managedOpenEscalation?.summary ??
                            managedFailure?.failure_message ??
                            "The previous safe version remains live while Autopilot selects another move."}
                        </p>
                      </div>
                      <span>Safe</span>
                    </article>
                  ) : (
                    <div className="owner-empty">
                      <i>✓</i>
                      <strong>Autopilot is watching for the next qualified move</strong>
                      <p>
                        Nothing needs your attention. The scheduler will start
                        automatically when the evidence supports worthwhile work.
                      </p>
                    </div>
                  )}
                </section>
              </div>
              <section className="owner-connection-strip">
                <div>
                  <small>CONNECTIONS</small>
                  <h2>Give HD SEO enough evidence to make better decisions</h2>
                </div>
                <span className={websitePublishingReady ? "ready" : ""}>
                  <i>{websitePublishingReady ? "✓" : "1"}</i>
                  <b>Website publishing</b>
                  <small>
                    {websitePublishingReady
                      ? `${friendlyStatus(website?.cmsType)} connected`
                      : websiteSetupPending
                        ? "Setup request is being reviewed"
                        : "Analysis works; editing is not connected"}
                  </small>
                </span>
                <span className={gsc ? "ready" : ""}>
                  <i>{gsc ? "✓" : "2"}</i>
                  <b>Google Search Console</b>
                  <small>
                    {gsc ? "Connected" : "See real searches and visits"}
                  </small>
                </span>
                {!gsc && project && (
                  <a
                    href={`/api/google/connect?projectId=${project.id}&returnUrl=/portal/client`}
                  >
                    Connect Google →
                  </a>
                )}
                {!websitePublishingReady && (
                  <button className="owner-connection-cta" type="button" onClick={openWebsiteSetup}>
                    Finish website setup →
                  </button>
                )}
              </section>
            </>
          )}

          {tab === "autopilot" && project && (
            isFreeTrial ? <TrialAutopilotPreview /> : <AgentServicePanel projects={[project]} role="client" canManage={selectedAccess?.role === "client_admin"} canApprove={canApprove} />
          )}

          {tab === "plan" && (
            <>
              <section className="owner-page-heading">
                <small>YOUR GROWTH ROADMAP</small>
                <h1>A clear plan, without SEO homework.</h1>
                <p>
                  HD SEO prioritizes actions by customer value, local relevance,
                  evidence, effort and risk.
                </p>
              </section>
              {isFreeTrial && <TrialPreviewNotice area="the 30/60/90-day growth roadmap" />}
              <section className="owner-plan-summary">
                <div>
                  <small>MARKET</small>
                  <strong>
                    {profile?.marketScope === "nationwide"
                      ? "Nationwide"
                      : "Service-area focused"}
                  </strong>
                  <span>
                    {profile?.marketScope === "nationwide"
                      ? "Research covers demand throughout the United States."
                      : profile?.serviceAreas.length
                        ? `Focused on ${profile.serviceAreas.join(", ")}`
                        : "Add a service area to keep research local."}
                  </span>
                </div>
                <div>
                  <small>CONTROL MODE</small>
                  <strong>
                    {profile?.automationLevel === "safe"
                      ? "Safe Autopilot"
                      : profile?.automationLevel === "concierge"
                        ? "Human-reviewed"
                        : "Recommend only"}
                  </strong>
                  <span>
                    High-risk, legal, pricing, DNS and destructive work always
                    pauses.
                  </span>
                </div>
                <div>
                  <small>MONTHLY LIMIT</small>
                  <strong>{money(profile?.monthlyBudget ?? 99)}</strong>
                  <span>A hard strategy and provider-spend guardrail.</span>
                </div>
              </section>
              <section className="owner-roadmap">
                {[
                  [
                    "NOW",
                    "Understand and protect",
                    [
                      "Verify the website and Google connection",
                      "Check technical problems that block discovery",
                      "Confirm services and service areas",
                    ],
                  ],
                  [
                    "NEXT",
                    "Win existing demand",
                    [
                      "Improve pages already close to producing results",
                      "Strengthen local business evidence",
                      "Fix weak internal links and customer paths",
                    ],
                  ],
                  [
                    "LATER",
                    "Build durable growth",
                    [
                      "Create only evidence-backed pages customers need",
                      "Earn legitimate local authority",
                      "Measure leads, value and continued improvement",
                    ],
                  ],
                ].map(([phase, title, items], index) => (
                  <article key={String(phase)}>
                    <span>{index + 1}</span>
                    <small>{phase}</small>
                    <h2>{title}</h2>
                    {(items as string[]).map((item) => (
                      <p key={item}>✓ {item}</p>
                    ))}
                  </article>
                ))}
              </section>
              <section className="owner-work-list">
                <header>
                  <div>
                    <small>ACTIVE WORK</small>
                    <h2>Your agent team</h2>
                  </div>
                </header>
                {company.agentWork.map((item) => (
                  <article key={item.id}>
                    <i>
                      {(agentNames[item.agentKey] ?? "HD")
                        .slice(0, 2)
                        .toUpperCase()}
                    </i>
                    <div>
                      <strong>
                        {agentNames[item.agentKey] ??
                          friendlyStatus(item.agentKey)}
                      </strong>
                      <p>{item.goal}</p>
                    </div>
                    <span>{friendlyStatus(item.status)}</span>
                  </article>
                ))}
                {!company.agentWork.length && (
                  <div className="owner-empty">
                    <strong>
                      Your plan is ready for its next scheduled run
                    </strong>
                    <p>
                      Start the agent team from Home if onboarding is not
                      active.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}

          {tab === "approvals" && (
            <>
              <section className="owner-page-heading">
                <small>DECISIONS</small>
                <h1>Only the choices that need you.</h1>
                <p>
                  Every request explains what customers see, why it matters, the
                  risk and what happens next.
                </p>
              </section>
              {isFreeTrial && <TrialPreviewNotice area="the approval inbox" />}
              {!isFreeTrial && project && <AgentServicePanel projects={[project]} role="client" canManage={false} canApprove={canApprove} decisionsOnly onDecisionCount={setManagedDecisionCount} />}
              <section className="owner-approval-stack">
                {approvals.map((item) => (
                  <article key={item.id}>
                    <div className="owner-approval-head">
                      <span>YOUR DECISION</span>
                      <small>Protected change</small>
                    </div>
                    <h2>{item.title}</h2>
                    <p>
                      {item.packageData?.metadata?.metaDescription ??
                        "HD SEO prepared this improvement and paused before making a customer-visible change."}
                    </p>
                    <div className="owner-approval-facts">
                      <span>
                        <b>Why it matters</b>Helps the right customers in this
                        business&apos;s market understand and find this service.
                      </span>
                      <span>
                        <b>What customers see</b>A clearer, more useful version
                        of the affected page.
                      </span>
                      <span>
                        <b>Safety</b>The change remains logged, validated and
                        rollback-ready.
                      </span>
                    </div>
                    <details>
                      <summary>Show technical details</summary>
                      <pre>
                        {JSON.stringify(item.packageData ?? {}, null, 2)}
                      </pre>
                    </details>
                    <button
                      className="owner-receipt-link"
                      onClick={() => setReceiptPackageId(item.id)}
                    >
                      See keyword plan, creative needs and proof →
                    </button>
                    {canApprove && (
                      <footer>
                        <button
                          disabled={busyId === item.id}
                          onClick={() =>
                            void decide(item.id, "revision_requested")
                          }
                        >
                          Ask for changes
                        </button>
                        <button
                          disabled={busyId === item.id}
                          onClick={() => {
                            setTab("business");
                            setMessage(
                              `Ask your question about “${item.title}” below.`,
                            );
                          }}
                        >
                          Ask HD SEO
                        </button>
                        <button
                          className="primary"
                          disabled={busyId === item.id}
                          onClick={() =>
                            void decide(item.id, "client_approved")
                          }
                        >
                          {busyId === item.id
                            ? "Saving…"
                            : "Approve and continue →"}
                        </button>
                      </footer>
                    )}
                  </article>
                ))}
                {!approvals.length && effectiveManagedDecisionCount===0 && (
                  <div className="owner-all-clear">
                    <i>✓</i>
                    <h2>Nothing is waiting on you</h2>
                    <p>
                      Safe work can continue according to your control setting.
                      Important decisions will appear here.
                    </p>
                  </div>
                )}
              </section>
              {company.packages.filter(
                (item) => !awaitingStatuses.has(item.status),
              ).length > 0 && (
                <section className="owner-previous-decisions">
                  <header>
                    <small>PREVIOUS DECISIONS</small>
                    <h2>Approval history</h2>
                  </header>
                  {company.packages
                    .filter((item) => !awaitingStatuses.has(item.status))
                    .map((item) => (
                      <article key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          <small>
                            {item.status === "client_approved"
                              ? "Authorized; open the receipt to see whether execution has started."
                              : friendlyStatus(item.status)}
                          </small>
                        </div>
                        <button onClick={() => setReceiptPackageId(item.id)}>
                          View work receipt
                        </button>
                      </article>
                    ))}
                </section>
              )}
            </>
          )}

          {tab === "results" && (
            <>
              <section className="owner-page-heading">
                <small>RESULTS</small>
                <h1>What changed, and what it produced.</h1>
                <p>
                  Rankings support the story. Calls, leads, bookings and
                  verifiable work are the outcome.
                </p>
              </section>
              {isFreeTrial && <TrialPreviewNotice area="crawl findings, proof of work, rankings, leads, and ROI reporting" />}
              <section className="owner-results-hero">
                <div>
                  <small>RECORDED BUSINESS VALUE · LAST 90 DAYS</small>
                  <strong>{money(outcome.recordedGrossProfit)}</strong>
                  <span>
                    {outcome.leads} leads · {outcome.qualifiedLeads} qualified ·{" "}
                    {money(outcome.recordedRevenue)} recorded revenue
                  </span>
                </div>
                <aside>
                  <span>
                    <b>{outcome.impressions.toLocaleString()}</b>Times shown on
                    Google
                  </span>
                  <span>
                    <b>{outcome.clicks.toLocaleString()}</b>Visits from Google
                  </span>
                  <span>
                    <b>{completed.length}</b>Completed improvements
                  </span>
                </aside>
              </section>
              <div className="owner-results-grid">
                <section>
                  <header>
                    <small>PROOF OF WORK</small>
                    <h2>What has been done</h2>
                  </header>
                  {company.events.slice(0, 20).map((item) => (
                    <article key={item.id}>
                      <i>✓</i>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                      </div>
                      <span>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </article>
                  ))}
                  {!company.events.length && (
                    <div className="owner-empty">
                      <strong>Your proof timeline is getting started</strong>
                      <p>
                        Completed and verified work will appear here
                        automatically.
                      </p>
                    </div>
                  )}
                </section>
                <section>
                  <header>
                    <small>WHAT THIS MEANS</small>
                    <h2>Plain-language summary</h2>
                  </header>
                  <div className="owner-result-explainer">
                    <p>
                      <b>{outcome.impressions.toLocaleString()}</b> times nearby
                      searchers saw your business in connected Google data.
                    </p>
                    <p>
                      <b>{outcome.clicks.toLocaleString()}</b> visits came from
                      those searches.
                    </p>
                    <p>
                      <b>{outcome.leads}</b> customer inquiries are currently
                      tied to SEO evidence.
                    </p>
                    <small>
                      Revenue and profit remain zero until an actual lead or
                      sale is recorded. HD SEO does not invent attribution.
                    </small>
                  </div>
                </section>
              </div>
              {project && (
                <OutcomesControlCenter
                  projects={[project]}
                  canManage
                  compact
                />
              )}
            </>
          )}

          {tab === "business" && project && (
            <BusinessSettings
              data={{
                profile,
                subscription,
                trialEntitlement,
                website,
                gsc,
                supportRequests: company.supportRequests,
              }}
              project={project}
              busy={busyId !== null}
              canManage={selectedAccess?.role === "client_admin"}
              onAction={act}
              onOpenDeploymentSetup={() => setDeploymentSetupProject(project)}
            />
          )}
        </div>
      </section>
    </main>
    {deploymentSetupProject && (
      <DeploymentSetupWizard
        agencyId={deploymentSetupProject.agencyId}
        project={deploymentSetupProject}
        portal="client"
        onClose={(refresh) => {
          setDeploymentSetupProject(null);
          if (refresh) window.location.reload();
        }}
        onOpenPackages={() => setTab("approvals")}
      />
    )}
    {receiptPackageId && project && (
      <WorkReceipt
        projectId={project.id}
        packageId={receiptPackageId}
        onClose={() => setReceiptPackageId(null)}
      />
    )}
    </>
  );
}

type OwnerConnectionChoice = "wordpress" | "shopify" | "webflow" | "guided";

function OwnerWebsiteSetup({
  project,
  website,
  busy,
  canManage,
  onAction,
  onOpenDeploymentSetup,
}: {
  project: Project;
  website: Website | undefined;
  busy: boolean;
  canManage: boolean;
  onAction: (body: Record<string, unknown>, success?: string) => Promise<PostActionResult | null>;
  onOpenDeploymentSetup: () => void;
}) {
  const detected = website?.cmsType ?? "unknown";
  const recommendedChoice: OwnerConnectionChoice = [
    "wordpress",
    "shopify",
    "webflow",
  ].includes(detected)
    ? (detected as OwnerConnectionChoice)
    : "guided";
  const [choice, setChoice] = useState<OwnerConnectionChoice>(recommendedChoice);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffEmail, setHandoffEmail] = useState(website?.connectionInvite?.recipientEmail ?? "");
  const [handoff, setHandoff] = useState<PostActionResult["handoff"]>();
  const [handoffMessage, setHandoffMessage] = useState("");
  const selectedChoice = showAlternatives ? choice : recommendedChoice;
  const setupPending =
    website?.connectionMode === "managed_migration" &&
    website.connectionStatus === "pending";
  const repositoryConnected =
    website?.connectionMode === "github_app" &&
    website.connectionStatus === "active";
  const repositoryBased = detected === "vercel" || repositoryConnected;
  const githubReturnUrl = "/portal/client?github=connected#owner-website-setup";
  const githubHref = `/api/github/install?agencyId=${encodeURIComponent(project.agencyId)}&clientId=${encodeURIComponent(project.clientId)}&projectId=${encodeURIComponent(project.id)}&returnUrl=${encodeURIComponent(githubReturnUrl)}`;

  function requestConnectionHelp() {
    void onAction(
      {
        action: "client_support",
        projectId: project.id,
        category: "connection_help",
        subject: `Help me connect ${project.domain}`,
        message: `I need HD SEO to finish the publishing connection for ${project.domain}. HD SEO detected ${friendlyStatus(detected)}. I do not want to choose technical credentials or deployment settings without guidance.`,
      },
      "Website connection help was requested. You can still use the connection choices on this page.",
    );
  }

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const guided = selectedChoice === "guided";
    if (guided) {
      requestConnectionHelp();
      return;
    }
    void onAction(
      {
        action: "connect_website",
        projectId: project.id,
        portal: "client",
        mode: selectedChoice,
        siteUrl:
          String(form.get("siteUrl") ?? "") ||
          website?.siteUrl ||
          `https://${project.domain}`,
        username: String(form.get("username") ?? "") || undefined,
        applicationPassword:
          String(form.get("applicationPassword") ?? "") || undefined,
        accessToken: String(form.get("accessToken") ?? "") || undefined,
        siteId: String(form.get("siteId") ?? "") || undefined,
        notes: undefined,
      },
      "Website publishing access was verified.",
    );
  }

  async function createHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHandoffMessage("");
    const result = await onAction({
      action: "create_website_connection_invite",
      projectId: project.id,
      recipientEmail: handoffEmail.trim() || undefined,
    });
    if (!result?.handoff) return;
    setHandoff(result.handoff);
    try {
      await navigator.clipboard.writeText(result.handoff.url);
      setHandoffMessage(result.handoff.delivery === "sent" ? "Email sent. The secure link was also copied." : "Secure link copied. Send it to the person who manages your website.");
    } catch {
      setHandoffMessage("The secure link is ready. Copy it below and send it to your website contact.");
    }
  }

  return (
    <section
      className={`owner-website-setup ${website?.publishingReady ? "ready" : setupPending ? "pending" : "attention"}`}
      id="owner-website-setup"
    >
      <header>
        <div>
          <small>WEBSITE SETUP</small>
          <h2>
            {website?.publishingReady
              ? "Your website is fully connected"
              : repositoryConnected
                ? "Your repository is connected—finish the safety setup"
              : setupPending
                ? "Choose how HD SEO should connect your website"
                : "Connect once, then HD SEO can do the work"}
          </h2>
          <p>
            {website?.publishingReady
              ? "HD SEO can prepare approved changes, publish through the verified connection, validate the result, and keep rollback protection."
              : "HD SEO has already inspected the public website. The remaining step gives it a safe, verified way to publish only the work you authorize."}
          </p>
        </div>
        <span>{website?.publishingReady ? "CONNECTED" : "ACTION NEEDED"}</span>
      </header>

      <div className="owner-setup-steps">
        <article className="done">
          <i>1</i>
          <div>
            <small>PLATFORM DETECTION</small>
            <strong>{friendlyStatus(detected)} detected</strong>
            <p>HD SEO inspected {project.domain}; you did not have to guess how the site was built.</p>
          </div>
          {canManage && !website?.publishingReady && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onAction(
                  { action: "retail_analyze_website", projectId: project.id },
                  "Website platform checked again.",
                )
              }
            >
              Check again
            </button>
          )}
        </article>
        <article className={website?.publishingReady || repositoryConnected ? "done" : "current"}>
          <i>2</i>
          <div>
            <small>SECURE ACCESS</small>
            <strong>
              {website?.publishingReady
                ? "Publishing access verified"
                : repositoryConnected
                  ? "Website repository authorized"
                  : "Follow the recommended connection below"}
            </strong>
            <p>Credentials are verified on the server, encrypted, and never shown back in the browser.</p>
          </div>
        </article>
        <article className={website?.publishingReady ? "done" : ""}>
          <i>3</i>
          <div>
            <small>SAFETY TEST</small>
            <strong>{website?.publishingReady ? "Publishing and rollback ready" : "HD SEO verifies the connection"}</strong>
            <p>No website change publishes from this setup screen. Approval and validation rules still apply.</p>
          </div>
        </article>
      </div>

      {!website?.publishingReady && repositoryBased && canManage && (
        <div className="owner-repository-connect">
          {setupPending && (
            <div className="owner-pending-note">
              <strong>Your help request is saved, but you do not have to wait.</strong>
              <span>Connect the repository now, or ask HD SEO to coordinate the remaining setup with your developer.</span>
            </div>
          )}
          <div>
            <small>{repositoryConnected ? "REPOSITORY AUTHORIZED" : "RECOMMENDED FOR THIS VERCEL SITE"}</small>
            <h3>{repositoryConnected ? "GitHub access is connected" : "Connect the website’s code repository"}</h3>
            <p>
              {repositoryConnected
                ? "HD SEO has permission to prepare changes for this website. The remaining safety checks keep it from publishing until preview, approval, and rollback protection are ready."
                : "Most Vercel websites deploy from GitHub. GitHub will ask which repository HD SEO may use, then return you here. HD SEO never receives your GitHub password."}
            </p>
            {!repositoryConnected && (
              <ol>
                <li>Sign in to GitHub.</li>
                <li>Select only this website’s repository.</li>
                <li>Return here so HD SEO can verify the connection.</li>
              </ol>
            )}
          </div>
          <div className="owner-repository-actions">
            <a className="owner-setup-submit" href={githubHref}>
              {repositoryConnected ? "Review or change repository →" : "Connect GitHub repository →"}
            </a>
            <button type="button" disabled={busy} onClick={repositoryConnected ? onOpenDeploymentSetup : requestConnectionHelp}>
              {repositoryConnected ? "Finish safe deployment setup" : "I don’t use GitHub—help me connect"}
            </button>
          </div>
          {repositoryConnected && website.publishingBlockers.length > 0 && (
            <div className="owner-publishing-blockers">
              <strong>Still protected</strong>
              <span>{website.publishingBlockers.map((blocker) => ({
                AGENCY_FEATURE_DISABLED: "Account automation awaiting activation",
                PROJECT_FEATURE_DISABLED: "Website automation awaiting activation",
                MANUAL_WORKFLOW_NOT_VERIFIED: "GitHub and Vercel safety test required",
                REPOSITORY_NOT_VERIFIED: "Repository verification required",
                READINESS_CHECK_FAILED: "Setup status needs to be checked again",
              }[blocker] ?? friendlyStatus(blocker))).join(" · ")}</span>
            </div>
          )}
        </div>
      )}

      {!website?.publishingReady && !repositoryBased && canManage && (
        <form className="owner-website-connect-form" onSubmit={connect}>
          <div className="owner-connection-recommendation">
            <small>RECOMMENDED FOR YOUR SITE</small>
            <strong>
              {recommendedChoice === "guided"
                ? "Let HD SEO guide the connection"
                : `Connect ${friendlyStatus(recommendedChoice)}`}
            </strong>
            <p>
              {recommendedChoice === "guided"
                ? `${friendlyStatus(detected)} sites may require an owner or developer handoff. Ask for help without locking this screen; you can change the connection method at any time.`
                : `HD SEO found the ${friendlyStatus(recommendedChoice)} signals on your website and selected the matching secure connection.`}
            </p>
            <button
              type="button"
              className={selectedChoice === recommendedChoice ? "selected" : ""}
              onClick={() => setChoice(recommendedChoice)}
            >
              {recommendedChoice === "guided" ? "Ask HD SEO for help" : `Use ${friendlyStatus(recommendedChoice)}`}
            </button>
          </div>

          {selectedChoice === "wordpress" && (
            <div className="owner-credential-fields">
              <label>
                WordPress username
                <input name="username" autoComplete="username" required />
              </label>
              <label>
                WordPress Application Password
                <input name="applicationPassword" type="password" autoComplete="new-password" required />
                <em>In WordPress: Users → Profile → Application Passwords. Do not enter your normal password.</em>
              </label>
            </div>
          )}
          {selectedChoice === "shopify" && (
            <div className="owner-credential-fields">
              <label>
                Permanent Shopify store address
                <input name="siteUrl" type="url" placeholder="https://store-name.myshopify.com" required />
                <em>This is the myshopify.com address, even if customers visit a different domain.</em>
              </label>
              <label>
                Shopify Admin API access token
                <input name="accessToken" type="password" autoComplete="new-password" placeholder="shpat_…" required />
                <em>If you do not have this, choose guided setup and HD SEO will explain exactly where to find it.</em>
              </label>
            </div>
          )}
          {selectedChoice === "webflow" && (
            <div className="owner-credential-fields">
              <label>
                Webflow site ID
                <input name="siteId" required />
              </label>
              <label>
                Webflow API token
                <input name="accessToken" type="password" autoComplete="new-password" required />
              </label>
            </div>
          )}

          <details
            className="owner-setup-alternatives"
            open={showAlternatives}
            onToggle={(event) => setShowAlternatives(event.currentTarget.open)}
          >
            <summary>That platform does not look right</summary>
            <p>Choose a different option only if you know the detected platform is wrong.</p>
            <div>
              {(["wordpress", "shopify", "webflow", "guided"] as OwnerConnectionChoice[]).map((option) => (
                <button
                  type="button"
                  className={selectedChoice === option ? "selected" : ""}
                  key={option}
                  onClick={() => setChoice(option)}
                >
                  {option === "guided" ? "I’m not sure—help me" : friendlyStatus(option)}
                </button>
              ))}
            </div>
          </details>

          <button className="owner-setup-submit" disabled={busy}>
            {busy
              ? "Checking securely…"
              : selectedChoice === "guided"
                ? "Ask HD SEO to guide this connection →"
                : `Verify and connect ${friendlyStatus(selectedChoice)} →`}
          </button>
        </form>
      )}

      {!website?.publishingReady && canManage && (
        <section className="owner-builder-handoff">
          <div>
            <small>DON’T HAVE WEBSITE ACCESS?</small>
            <h3>Send setup to the person who built your website</h3>
            <p>They get a secure, seven-day link that can only connect {project.domain}. They cannot see your billing, leads, rankings, approvals, or HD SEO account.</p>
            {website?.connectionInvite && !handoff && (
              <span className={`handoff-status ${website.connectionInvite.status}`}>
                Last link: {friendlyStatus(website.connectionInvite.status)}
                {website.connectionInvite.firstOpenedAt ? " · Opened" : " · Not opened yet"}
              </span>
            )}
          </div>
          {!showHandoff && !handoff ? (
            <button type="button" onClick={() => setShowHandoff(true)}>Send a secure setup link →</button>
          ) : (
            <form onSubmit={createHandoff}>
              {!handoff && (
                <label>
                  Website contact’s email <em>(optional)</em>
                  <input value={handoffEmail} onChange={(event) => setHandoffEmail(event.target.value)} type="email" placeholder="developer@example.com" />
                </label>
              )}
              {handoff && (
                <label>
                  Secure setup link
                  <input value={handoff.url} readOnly onFocus={(event) => event.currentTarget.select()} />
                </label>
              )}
              <div>
                {handoff ? (
                  <>
                    <button type="button" onClick={() => void navigator.clipboard.writeText(handoff.url)}>Copy link</button>
                    <a href={`mailto:${encodeURIComponent(handoffEmail)}?subject=${encodeURIComponent(`Website access needed for ${project.domain}`)}&body=${encodeURIComponent(`Please use this secure HD SEO link to connect the website you manage. It only grants setup access for ${project.domain} and expires in seven days:\n\n${handoff.url}`)}`}>Open email</a>
                    <button type="button" onClick={() => { setHandoff(undefined); setShowHandoff(false); }}>Done</button>
                  </>
                ) : (
                  <>
                    <button type="submit" disabled={busy}>{busy ? "Creating link…" : handoffEmail ? "Email and copy link" : "Create and copy link"}</button>
                    <button type="button" onClick={() => setShowHandoff(false)}>Cancel</button>
                  </>
                )}
              </div>
              {handoffMessage && <p role="status">{handoffMessage}</p>}
            </form>
          )}
        </section>
      )}

      {!canManage && !website?.publishingReady && (
        <div className="owner-setup-viewer-note">
          The business owner must complete this one-time connection.
        </div>
      )}
    </section>
  );
}

function BusinessSettings({
  data,
  project,
  busy,
  canManage,
  onAction,
  onOpenDeploymentSetup,
}: {
  data: {
    profile: GrowthProfile | undefined;
    subscription: Subscription | undefined;
    trialEntitlement: TrialEntitlement | undefined;
    website: Website | undefined;
    gsc: Integration | undefined;
    supportRequests: SupportRequest[];
  };
  project: Project;
  busy: boolean;
  canManage: boolean;
  onAction: (body: Record<string, unknown>, success?: string) => Promise<PostActionResult | null>;
  onOpenDeploymentSetup: () => void;
}) {
  const profile = data.profile;
  const [marketScope, setMarketScope] = useState<"service_area" | "nationwide">(
    profile?.marketScope ?? "service_area",
  );
  const [billingBusy, setBillingBusy] = useState<string | null>(null),
    [billingMessage, setBillingMessage] = useState("");
  async function billing(
    path: string,
    body: Record<string, unknown>,
    key: string,
  ) {
    setBillingBusy(key);
    setBillingMessage("");
    try {
      const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message ?? "Billing could not be opened.",
        );
      if (payload.url) window.location.assign(payload.url);
    } catch (error) {
      setBillingMessage(
        error instanceof Error ? error.message : "Billing could not be opened.",
      );
    } finally {
      setBillingBusy(null);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onAction(
      {
        action: "retail_update_profile",
        projectId: project.id,
        businessGoal: form.get("businessGoal"),
        services: splitList(form.get("services")),
        serviceAreas:
          marketScope === "nationwide"
            ? (profile?.serviceAreas ?? [])
            : splitList(form.get("serviceAreas")),
        marketScope,
        priorityServices: splitList(form.get("priorityServices")),
        idealCustomer: form.get("idealCustomer"),
        averageCustomerValue: form.get("averageCustomerValue")
          ? Number(form.get("averageCustomerValue"))
          : undefined,
        monthlyBudget: Number(form.get("monthlyBudget") || 99),
        automationLevel: form.get("automationLevel"),
        notificationPreferences: {
          weeklySummary: form.get("weeklySummary") === "on",
          approvalNeeded: form.get("approvalNeeded") === "on",
          results: form.get("results") === "on",
        },
      },
      "Your business profile was saved.",
    );
  }
  function support(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onAction(
      {
        action: "client_support",
        projectId: project.id,
        category: form.get("category"),
        subject: form.get("subject"),
        message: form.get("message"),
      },
      "Your question was sent.",
    );
    event.currentTarget.reset();
  }
  return (
    <>
      <section className="owner-page-heading">
        <small>MY BUSINESS</small>
        <h1>Teach HD SEO what matters.</h1>
        <p>
          These facts keep every recommendation relevant to your services,
          geography and customer value.
        </p>
      </section>
      <OwnerWebsiteSetup
        project={project}
        website={data.website}
        busy={busy}
        canManage={canManage}
        onAction={onAction}
        onOpenDeploymentSetup={onOpenDeploymentSetup}
      />
      <div className="owner-settings-grid">
        <form className="owner-settings-card" onSubmit={save}>
          <header>
            <small>GROWTH PROFILE</small>
            <h2>Business priorities</h2>
          </header>
          <label>
            Primary goal
            <select
              name="businessGoal"
              defaultValue={profile?.businessGoal ?? "more_qualified_leads"}
            >
              {Object.entries(goalLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Services
            <textarea
              name="services"
              defaultValue={profile?.services.join(", ")}
              required
            />
          </label>
          <fieldset>
            <legend>Customer market</legend>
            <label className="owner-radio">
              <input
                type="radio"
                name="marketScope"
                value="service_area"
                checked={marketScope === "service_area"}
                onChange={() => setMarketScope("service_area")}
              />
              <span>Specific service areas</span>
            </label>
            <label className="owner-radio">
              <input
                type="radio"
                name="marketScope"
                value="nationwide"
                checked={marketScope === "nationwide"}
                onChange={() => setMarketScope("nationwide")}
              />
              <span>Nationwide</span>
            </label>
          </fieldset>
          {marketScope === "service_area" && (
            <label>
              Verified service areas
              <textarea
                name="serviceAreas"
                defaultValue={profile?.serviceAreas.join(", ")}
                required
              />
              <em>HD SEO will exclude explicit searches outside these areas.</em>
            </label>
          )}
          <label>
            Highest-priority services
            <textarea
              name="priorityServices"
              defaultValue={profile?.priorityServices.join(", ")}
            />
          </label>
          <label>
            Ideal customer
            <textarea
              name="idealCustomer"
              defaultValue={profile?.idealCustomer ?? ""}
            />
          </label>
          <div className="owner-form-row">
            <label>
              Average customer value
              <input
                name="averageCustomerValue"
                type="number"
                min="0"
                defaultValue={profile?.averageCustomerValue ?? ""}
              />
            </label>
            <label>
              Optional external SEO spend ceiling
              <input
                name="monthlyBudget"
                type="number"
                min="0"
                defaultValue={profile?.monthlyBudget ?? 99}
              />
              <em>
                Your plan already covers included agent work, implementation,
                QA and monitoring. This separate ceiling is only for itemized
                third-party costs you approve; $0 is allowed.
              </em>
            </label>
          </div>
          <fieldset>
            <legend>Control mode</legend>
            {[
              ["recommend", "Recommend only"],
              ["safe", "Safe Autopilot"],
              ["concierge", "Human-reviewed"],
            ].map(([value, label]) => (
              <label className="owner-radio" key={value}>
                <input
                  type="radio"
                  name="automationLevel"
                  value={value}
                  defaultChecked={
                    (profile?.automationLevel ?? "safe") === value
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Notify me when</legend>
            <label className="owner-check">
              <input
                type="checkbox"
                name="approvalNeeded"
                defaultChecked={
                  profile?.notificationPreferences.approvalNeeded !== false
                }
              />
              A decision needs me
            </label>
            <label className="owner-check">
              <input
                type="checkbox"
                name="weeklySummary"
                defaultChecked={
                  profile?.notificationPreferences.weeklySummary !== false
                }
              />
              My weekly summary is ready
            </label>
            <label className="owner-check">
              <input
                type="checkbox"
                name="results"
                defaultChecked={
                  profile?.notificationPreferences.results !== false
                }
              />
              A result or milestone is recorded
            </label>
          </fieldset>
          <button className="owner-primary" disabled={busy}>
            Save business settings
          </button>
        </form>
        <div className="owner-settings-side">
          <section className="owner-settings-card">
            <header>
              <small>CONNECTIONS</small>
              <h2>Evidence and publishing</h2>
            </header>
            <div className="owner-connection-row">
              <i className={data.website?.publishingReady ? "ready" : ""}>
                {data.website?.publishingReady ? "✓" : "!"}
              </i>
              <div>
                <strong>Website publishing</strong>
                <span>
                  {data.website?.publishingReady
                    ? `${friendlyStatus(data.website.cmsType)} · Connected and verified`
                    : data.website?.connectionMode === "managed_migration" && data.website.connectionStatus === "pending"
                      ? "Guided setup requested"
                      : `Analysis only${data.website ? ` · ${friendlyStatus(data.website.cmsType)} detected` : ""}`}
                </span>
              </div>
              {!data.website?.publishingReady && (
                <a href="#owner-website-setup">Finish setup</a>
              )}
            </div>
            <div className="owner-connection-row">
              <i className={data.gsc ? "ready" : ""}>{data.gsc ? "✓" : "!"}</i>
              <div>
                <strong>Google Search Console</strong>
                <span>
                  {data.gsc
                    ? "Connected to real search evidence"
                    : "Not connected"}
                </span>
              </div>
              {!data.gsc && (
                <a
                  href={`/api/google/connect?projectId=${project.id}&returnUrl=/portal/client`}
                >
                  Connect
                </a>
              )}
            </div>
          </section>
          <section className="owner-settings-card owner-plan-card">
            <header>
              <small>YOUR PLAN</small>
              <h2>{planLabels[data.subscription?.planKey ?? "free_audit"]}</h2>
            </header>
            <strong>
              {data.subscription?.offerKey===FOUNDING_BETA_OFFER_KEY&&data.subscription.offerPriceCents
                ? `${money(data.subscription.offerPriceCents / 100)} Founding Beta`
                : data.subscription?.priceCents
                ? `${money(data.subscription.priceCents / 100)}/month`
                : "Free audit period"}
            </strong>
            <p>
              {data.subscription?.offerKey===FOUNDING_BETA_OFFER_KEY&&data.subscription.offerEndsAt
                ? `Founding Beta through ${new Date(data.subscription.offerEndsAt).toLocaleDateString()}, then ${money(data.subscription.priceCents/100)}/month unless canceled.`
                : data.subscription?.trialEndsAt
                ? `Trial through ${new Date(data.subscription.trialEndsAt).toLocaleDateString()}.`
                : "Your account remains protected by plan and spending limits."}
            </p>
            {data.subscription?.planKey === "free_audit" && (
              <div className="owner-trial-meter">
                <span><b>{data.trialEntitlement?.remaining ?? 0}</b> of {data.trialEntitlement?.allowance ?? 1} free crawls remaining</span>
                <small>One crawl covers up to 25 public pages. It does not include paid keyword data or publishing.</small>
              </div>
            )}
            {billingMessage && (
              <div className="owner-error">{billingMessage}</div>
            )}
            <button
              onClick={() =>
                document
                  .getElementById("owner-plans")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Compare plans
            </button>
            {data.subscription?.priceCents ? (
              <button
                disabled={billingBusy !== null}
                onClick={() =>
                  void billing(
                    "/api/billing/portal",
                    { projectId: project.id },
                    "portal",
                  )
                }
              >
                {billingBusy === "portal" ? "Opening…" : "Manage billing"}
              </button>
            ) : null}
          </section>
          <form className="owner-settings-card" onSubmit={support}>
            <header>
              <small>ASK HD SEO</small>
              <h2>Get help in plain language</h2>
            </header>
            <label>
              What do you need?
              <select name="category">
                <option value="question">General question</option>
                <option value="connection_help">
                  Help connecting my website
                </option>
                <option value="approval_help">Help with an approval</option>
                <option value="result_question">Question about results</option>
                <option value="billing">Plan or billing</option>
              </select>
            </label>
            <label>
              Subject
              <input
                name="subject"
                minLength={3}
                required
                placeholder="What should I do next?"
              />
            </label>
            <label>
              Message
              <textarea
                name="message"
                minLength={10}
                required
                placeholder="You do not need to use SEO terms. Tell us what you are trying to accomplish."
              />
            </label>
            <button className="owner-primary" disabled={busy}>
              Send my question
            </button>
            {data.supportRequests
              .filter((item) => !["resolved", "closed"].includes(item.status))
              .map((item) => (
                <span className="owner-open-request" key={item.id}>
                  <b>{item.subject}</b>
                  {friendlyStatus(item.status)}
                </span>
              ))}
          </form>
        </div>
      </div>
      <section className="owner-pricing" id="owner-plans">
        <header>
          <small>PLANS THAT GROW WITH YOU</small>
          <h2>Start simple. Add automation when it earns your trust.</h2>
        </header>
        <div>
          {([
            ["starter","Foundational SEO implementation for one business website"],
            ["growth","Operate six guided SEO workflows with evidence, controls and validation"],
            ["pro","Six managed actions, one major page and 30 minutes of human strategy"],
            ["autopilot_plus","Ten managed actions, two major pages and 60 minutes of human strategy"],
          ] as const).map(([key,detail]) => {const plan=retailBillingPlans[key],betaEligible=data.subscription?.planKey==="free_audit"&&!data.subscription.betaRedeemedAt,name=plan.label,price=betaEligible?money(plan.beta.priceCents/100):money(plan.priceCents/100);return (
            <article className={key === "pro" ? "featured" : ""} key={key}>
              <small>{betaEligible?key==="pro"?"RUN IT FOR ME · FOUNDING BETA":"FOUNDING BETA":key === "pro" ? "BEST VALUE" : "MONTHLY"}</small>
              <h3>{name}</h3>
              <strong>
                {price}
                <em>{betaEligible?" first month":"/mo"}</em>
              </strong>
              {betaEligible&&<span className="owner-beta-renewal">Then {money(plan.priceCents/100)}/month unless canceled · {plan.beta.enrollmentLimit} spots</span>}
              <p>{detail}</p>
              <button
                disabled={
                  billingBusy !== null || data.subscription?.planKey === key
                }
                onClick={() =>
                  void billing(
                    "/api/billing/checkout",
                    { projectId: project.id, planKey: key,...(betaEligible?{offerKey:FOUNDING_BETA_OFFER_KEY}:{}) },
                    key,
                  )
                }
              >
                {data.subscription?.planKey === key
                  ? "Current plan"
                  : billingBusy === key
                    ? "Opening secure checkout…"
                    : betaEligible?`Start ${name} Beta`:`Choose ${name}`}
              </button>
            </article>
          )})}
        </div>
      </section>
    </>
  );
}
