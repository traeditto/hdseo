"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { OutcomesControlCenter } from "@/app/ui/outcomes-control-center";
import { AgentServicePanel } from "@/app/ui/agent-service-panel";

type User = { displayName: string; email: string };
type Client = { id: string; name: string; domain: string; status: string };
type Project = {
  id: string;
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
  planKey: "free_audit" | "starter" | "growth" | "pro";
  status: string;
  billingInterval: string;
  priceCents: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};
type Website = {
  id: string;
  projectId: string;
  siteUrl: string;
  cmsType: string;
  status: string;
  lastVerifiedAt: string | null;
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
  growth: "Growth",
  pro: "Scale",
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
  return result as { data: ClientData; message?: string };
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
                Monthly growth budget
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
                  This is a spending guardrail, not permission for unrestricted
                  charges.
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
                  : "Create my growth workspace →"}
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
    ),
    topOpportunity = company.opportunities[0] ?? null;
  const gsc = company.integrations.find(
      (item) =>
        item.provider === "google_search_console" && item.status === "active",
    ),
    website = company.websites[0];

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

  async function act(body: Record<string, unknown>, success?: string) {
    setBusyId(String(body.packageId ?? body.action));
    setMessage("");
    try {
      const result = await postAction(body);
      setData(result.data);
      setMessage(result.message ?? success ?? "Saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The action could not be completed.",
      );
    } finally {
      setBusyId(null);
    }
  }
  async function decide(packageId: string, decision: string) {
    await act(
      { action: "package_decision", packageId, decision },
      decision === "client_approved"
        ? "Approved. HD SEO can continue."
        : "Your feedback was sent.",
    );
  }

  const nav: Array<[Tab, string, string]> = [
    ["home", "Home", "⌂"],
    ["autopilot", "Autopilot", "✦"],
    ["plan", "My Plan", "◫"],
    ["approvals", "Approvals", String(approvals.length)],
    ["results", "Results", "↗"],
    ["business", "My Business", "◎"],
  ];
  const statusTitle = approvals.length
    ? "We need one quick decision"
    : profile?.onboardingStatus !== "active"
      ? "Finish setup to start growing"
      : company.agentWork.length
        ? "HD SEO is working for you"
        : "Your growth plan is on track";
  const statusText = approvals.length
    ? "Approving or requesting changes keeps the highest-value work moving."
    : profile?.onboardingStatus !== "active"
      ? "Confirm your connections, then let the agent team begin the first local audit."
      : company.agentWork.length
        ? `${company.agentWork.length} agent task${company.agentWork.length === 1 ? " is" : "s are"} researching, planning or validating work.`
        : "Nothing needs your attention right now.";

  return (
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
            <span className={approvals.length ? "attention" : ""}>
              {approvals.length
                ? `${approvals.length} decision${approvals.length === 1 ? "" : "s"} waiting`
                : "You’re all set"}
            </span>
            <button onClick={() => setTab("business")}>Ask HD SEO</button>
          </div>
        </header>
        <div className="owner-content">
          {message && (
            <div className="owner-flash" role="status">
              {message}
            </div>
          )}
          {tab === "home" && (
            <>
              <section
                className={`owner-status-hero ${approvals.length ? "attention" : ""}`}
              >
                <div>
                  <small>
                    {approvals.length ? "ABOUT 2 MINUTES" : "TODAY"}
                  </small>
                  <h1>{statusTitle}</h1>
                  <p>{statusText}</p>
                </div>
                {approvals.length ? (
                  <button onClick={() => setTab("approvals")}>
                    Review the decision →
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
                      {topOpportunity ? "Recommended" : "Researching"}
                    </span>
                  </header>
                  {topOpportunity ? (
                    <>
                      <h2>
                        Help more {profile?.marketScope === "nationwide" ? "customers" : "nearby customers"} find{" "}
                        {profile?.priorityServices[0] ??
                          profile?.services[0] ??
                          "your services"}
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
                        See where this fits in my plan →
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
                  ) : (
                    <div className="owner-empty">
                      <i>✓</i>
                      <strong>No work is blocked</strong>
                      <p>The next scheduled run will appear here.</p>
                    </div>
                  )}
                </section>
              </div>
              <section className="owner-connection-strip">
                <div>
                  <small>CONNECTIONS</small>
                  <h2>Give HD SEO enough evidence to make better decisions</h2>
                </div>
                <span className={website?.status === "active" ? "ready" : ""}>
                  <i>{website?.status === "active" ? "✓" : "1"}</i>
                  <b>Website</b>
                  <small>
                    {website?.status === "active"
                      ? `${friendlyStatus(website.cmsType)} detected`
                      : "Needs attention"}
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
              </section>
            </>
          )}

          {tab === "autopilot" && project && (
            <AgentServicePanel
              projects={[project]}
              role="client"
              canManage={selectedAccess?.role === "client_admin"}
              canApprove={canApprove}
            />
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
                {!approvals.length && (
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
                        <strong>{item.title}</strong>
                        <span>{friendlyStatus(item.status)}</span>
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
                website,
                gsc,
                supportRequests: company.supportRequests,
              }}
              project={project}
              busy={busyId !== null}
              onAction={act}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function BusinessSettings({
  data,
  project,
  busy,
  onAction,
}: {
  data: {
    profile: GrowthProfile | undefined;
    subscription: Subscription | undefined;
    website: Website | undefined;
    gsc: Integration | undefined;
    supportRequests: SupportRequest[];
  };
  project: Project;
  busy: boolean;
  onAction: (body: Record<string, unknown>, success?: string) => Promise<void>;
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
              Monthly limit
              <input
                name="monthlyBudget"
                type="number"
                min="0"
                defaultValue={profile?.monthlyBudget ?? 99}
              />
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
              <i className={data.website?.status === "active" ? "ready" : ""}>
                {data.website?.status === "active" ? "✓" : "!"}
              </i>
              <div>
                <strong>Website</strong>
                <span>
                  {data.website
                    ? `${friendlyStatus(data.website.cmsType)} · ${friendlyStatus(data.website.status)}`
                    : "Not connected"}
                </span>
              </div>
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
              {data.subscription?.priceCents
                ? `${money(data.subscription.priceCents / 100)}/month`
                : "Free audit period"}
            </strong>
            <p>
              {data.subscription?.trialEndsAt
                ? `Trial through ${new Date(data.subscription.trialEndsAt).toLocaleDateString()}.`
                : "Your account remains protected by plan and spending limits."}
            </p>
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
          {[
            [
              "starter",
              "Essentials",
              "$199",
              "Foundational SEO implementation for one business website",
            ],
            [
              "growth",
              "Growth",
              "$499",
              "Consistent implementation, publishing and outcome tracking",
            ],
            [
              "pro",
              "Scale",
              "$999",
              "Multi-site and multi-location execution with advanced controls",
            ],
          ].map(([key, name, price, detail]) => (
            <article className={key === "growth" ? "featured" : ""} key={key}>
              <small>{key === "growth" ? "RECOMMENDED" : "MONTHLY"}</small>
              <h3>{name}</h3>
              <strong>
                {price}
                <em>/mo</em>
              </strong>
              <p>{detail}</p>
              <button
                disabled={
                  billingBusy !== null || data.subscription?.planKey === key
                }
                onClick={() =>
                  void billing(
                    "/api/billing/checkout",
                    { projectId: project.id, planKey: key },
                    key,
                  )
                }
              >
                {data.subscription?.planKey === key
                  ? "Current plan"
                  : billingBusy === key
                    ? "Opening secure checkout…"
                    : `Choose ${name}`}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
