"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { WebsiteConnections } from "@/app/ui/website-connections";
import { ClientOnboardingWizard } from "@/app/ui/client-onboarding-wizard";
import { AgentWorkspace } from "@/app/ui/agent-workspace";
import { CreativeStudio } from "@/app/ui/creative-studio";
import { LocalGrowthEngine } from "@/app/ui/local-growth-engine";
import { AgencyClientCommandCenter } from "@/app/ui/agency-client-command-center";
import {
  assessKeywordServiceArea,
  buildServiceAreaPolicy,
} from "@/lib/seo/service-area";
import {
  buildImplementationOptions,
  type ImplementationReadiness,
} from "@/lib/seo/implementation-options";

type Agency = { id: string; name: string; slug: string };
type Client = {
  id: string;
  name: string;
  domain: string;
  contactEmail: string | null;
  status: string;
};
type Project = {
  id: string;
  clientId: string;
  name: string;
  domain: string;
  status: string;
  marketScope: "service_area" | "nationwide";
};
type Opportunity = {
  id: string;
  projectId: string;
  keyword: string;
  currentRank: number | null;
  targetRank: number;
  score: number;
  actionType: string;
  reason: string;
  status: string;
  searchVolume: number | null;
  cpc: number | null;
  difficulty: number | null;
  estimatedMonthlyValue: number | null;
  estimatedEffort: number | null;
  valuePerDollar: number | null;
  source: string;
};
type Task = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  implementationPath: string | null;
};
type PackageData = {
  metadata?: { title?: string; metaDescription?: string };
  acceptanceCriteria?: string[];
  verificationChecklist?: string[];
  delivery?: {
    mode?: string;
    provider?: string | null;
    label?: string;
    approvalRequired?: boolean;
  };
};
type Package = {
  id: string;
  projectId: string;
  title: string;
  implementationPath: string;
  status: string;
  packageData: PackageData;
  publicationId: string | null;
  publicationStatus: string | null;
  publicationProvider: string | null;
};
type Event = {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
};
type Job = {
  id: string;
  projectId: string;
  status: string;
  currentStage: string;
  progressPercent: number;
  errorMessage: string | null;
  referenceId: string;
  createdAt: string;
  updatedAt: string;
};
type Website = {
  id: string;
  projectId: string;
  name: string;
  siteUrl: string;
  canonicalDomain: string;
  cmsType: string;
  status: string;
  lastVerifiedAt: string | null;
  connectionId: string | null;
  connectionMode: string | null;
  connectionStatus: string | null;
  editorMode: string | null;
  googleSearchConsole: {
    id: string;
    status: string;
    selectedProperty: string | null;
    lastSyncedAt: string | null;
    lastVerifiedAt: string | null;
    properties: Array<{ siteUrl: string; permissionLevel?: string }>;
    health: string;
  } | null;
};
type Onboarding = {
  clientId: string;
  projectId: string;
  status: string;
  monthlyBudget: number;
  targetMarket: string;
  services: string[];
  serviceAreas: string[];
  marketScope: "service_area" | "nationwide";
  phone: string | null;
  automationLevel: "recommend" | "safe" | "autopilot";
  detectedPlatform: string;
  platformLabel: string;
  platformConfidence: string;
  websiteReachable: boolean;
  launchedAt: string | null;
};
type Data = {
  agency: Agency | null;
  role: string | null;
  clients: Client[];
  projects: Project[];
  websites: Website[];
  opportunities: Opportunity[];
  tasks: Task[];
  packages: Package[];
  events: Event[];
  jobs: Job[];
  onboardings: Onboarding[];
  implementationReadiness: ImplementationReadiness[];
  permissions: string[];
};
const tabs = [
  "Clients",
  "Overview",
  "Approvals",
  "Local Growth",
  "Opportunities",
  "Agent Workspace",
  "Creative Studio",
  "Websites",
  "Automation",
  "Work queue",
  "Packages",
  "Activity",
  "Onboarding",
];

export function LiveAgencyDashboard({
  initialData,
  user,
  initialTab,
  initialOnboardingProjectId,
  initialOnboardingStep,
}: {
  initialData: Data;
  user: { displayName: string; email: string };
  initialTab?: string;
  initialOnboardingProjectId?: string;
  initialOnboardingStep?: string;
}) {
  const [data, setData] = useState(initialData),
    [tab, setTab] = useState(() =>
      tabs.includes(initialTab ?? "") ? initialTab! : "Clients",
    ),
    [selectedClientId, setSelectedClientId] = useState<string | null>(null),
    [dialog, setDialog] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const clientNames = Object.fromEntries(
      data.clients.map((item) => [item.id, item.name]),
    ),
    projectNames = Object.fromEntries(
      data.projects.map((item) => [
        item.id,
        clientNames[item.clientId] ?? item.name,
      ]),
    ),
    serviceAreaPolicies = new Map(
      data.onboardings.map((item) => [
        item.projectId,
        buildServiceAreaPolicy({
          primaryMarket: item.targetMarket,
          marketScope: item.marketScope,
          serviceAreas: item.serviceAreas.map((name, index) => ({
            name,
            priority: 100 - index,
          })),
          services: item.services.map((name, index) => ({
            name,
            priority: 100 - index,
          })),
        }),
      ]),
    ),
    visibleOpportunities = data.opportunities.filter((item) => {
      const policy = serviceAreaPolicies.get(item.projectId);
      return !policy || assessKeywordServiceArea(item.keyword, policy).allowed;
    }),
    selectedClient =
      data.clients.find((item) => item.id === selectedClientId) ?? null,
    selectedProjectIds = new Set(
      data.projects
        .filter(
          (item) => !selectedClientId || item.clientId === selectedClientId,
        )
        .map((item) => item.id),
    ),
    scopedProjects = data.projects.filter((item) =>
      selectedProjectIds.has(item.id),
    ),
    scopedOpportunities = visibleOpportunities.filter(
      (item) =>
        selectedProjectIds.has(item.projectId) &&
        !["dismissed", "rejected", "completed"].includes(item.status),
    ),
    scopedTasks = data.tasks.filter((item) =>
      selectedProjectIds.has(item.projectId),
    ),
    scopedPackages = data.packages.filter((item) =>
      selectedProjectIds.has(item.projectId),
    ),
    scopedJobs = data.jobs.filter((item) =>
      selectedProjectIds.has(item.projectId),
    ),
    scopedWebsites = data.websites.filter((item) =>
      selectedProjectIds.has(item.projectId),
    ),
    can = (permission: string) => data.permissions.includes(permission);
  function openClientTab(clientId: string | undefined, nextTab: string) {
    setSelectedClientId(clientId ?? null);
    setTab(nextTab);
  }
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        result = await response.json();
      if (!response.ok) {
        setMessage(
          result.error?.message ?? "The action could not be completed.",
        );
        return false;
      }
      setData(result.data);
      setDialog(null);
      setMessage(result.message ?? "Saved");
      window.setTimeout(() => setMessage(""), 6500);
      return true;
    } catch {
      setMessage(
        "The action could not be completed. Check the connection and try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function form(
    event: FormEvent<HTMLFormElement>,
    action: string,
    transform?: (data: FormData) => Record<string, unknown>,
  ) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void act({
      action,
      ...(transform ? transform(values) : Object.fromEntries(values)),
    });
  }
  if (!data.agency)
    return (
      <main className="live-onboarding">
        <div className="live-onboarding-card">
          <span className="login-mark">
            <i />
            <b />
          </span>
          <small>HD SEO · FIRST-RUN SETUP</small>
          <h1>Create your agency workspace</h1>
          <p>
            This becomes your real, private operating workspace. Client records
            and SEO work will be saved securely.
          </p>
          <form onSubmit={(event) => form(event, "create_agency")}>
            <label>
              Agency name
              <input
                name="name"
                required
                minLength={2}
                placeholder="Your agency name"
              />
            </label>
            {message && <div className="login-message">{message}</div>}
            <button disabled={busy}>
              {busy ? "Creating workspace…" : "Create live workspace →"}
            </button>
          </form>
        </div>
      </main>
    );
  const next = scopedOpportunities[0];
  return (
    <main className="live-shell">
      <aside className="live-sidebar">
        <Link className="role-brand" href="/">
          <span className="login-mark">
            <i />
            <b />
          </span>
          <span>
            HD <em>SEO</em>
          </span>
        </Link>
        <div className="live-workspace">
          <small>AGENCY WORKSPACE</small>
          <strong>{data.agency.name}</strong>
          <span>{data.role?.replaceAll("_", " ")}</span>
        </div>
        <nav>
          {tabs.map((item) => (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="live-user">
          <strong>{user.displayName}</strong>
          <span>{user.email}</span>
          <a href="/api/auth/signout">Sign out</a>
        </div>
      </aside>
      <section className="live-main">
        <header>
          <div>
            <small>
              {selectedClient ? "SELECTED CLIENT" : "LIVE AGENCY OPERATIONS"}
            </small>
            <strong>
              {selectedClient ? `${selectedClient.name} · ${tab}` : tab}
            </strong>
          </div>
          <div>
            {selectedClient && (
              <button
                className="client-scope-clear"
                onClick={() => setSelectedClientId(null)}
              >
                ← All clients
              </button>
            )}
            {message && <span className="live-saved">✓ {message}</span>}
            {can("clients.manage") && (
              <button
                className="solid-button"
                onClick={() => setTab("Onboarding")}
              >
                ＋ Add client
              </button>
            )}
          </div>
        </header>
        <div className="live-content">
          {tab === "Overview" && (
            <>
              <div className="live-heading">
                <div>
                  <small>AUTOMATED SEO COMMAND CENTER</small>
                  <h1>
                    {selectedClient
                      ? selectedClient.name
                      : `Good morning, ${user.displayName.split(" ")[0]}`}
                  </h1>
                  <p>
                    {selectedClient
                      ? `A focused view of ${selectedClient.name}'s approvals, opportunities, and active work.`
                      : "HD SEO finds, values, and prioritizes keywords from each client's real domain data."}
                  </p>
                </div>
                {can("provider.authorize") && (
                  <button
                    onClick={() => setDialog("discovery")}
                    disabled={!scopedProjects.length || busy}
                  >
                    {busy ? "Analyzing domain…" : "✦ Find best keywords"}
                  </button>
                )}
              </div>
              <section className="live-metrics">
                <article>
                  <small>
                    {selectedClient ? "CLIENT PROJECTS" : "ACTIVE CLIENTS"}
                  </small>
                  <strong>
                    {selectedClient
                      ? scopedProjects.length
                      : data.clients.length}
                  </strong>
                  <span>
                    {selectedClient
                      ? selectedClient.domain
                      : `${data.projects.length} SEO projects`}
                  </span>
                </article>
                <article>
                  <small>PRIORITIZED KEYWORDS</small>
                  <strong>
                    {
                      scopedOpportunities.filter(
                        (item) => item.status === "open",
                      ).length
                    }
                  </strong>
                  <span>Automatically ranked by value</span>
                </article>
                <article>
                  <small>OPEN TASKS</small>
                  <strong>
                    {
                      scopedTasks.filter((item) => item.status !== "completed")
                        .length
                    }
                  </strong>
                  <span>Assigned agency work</span>
                </article>
                <article>
                  <small>AUTOMATION RUNS</small>
                  <strong>
                    {
                      scopedJobs.filter(
                        (item) =>
                          ![
                            "completed",
                            "cancelled",
                            "failed",
                            "stale",
                          ].includes(item.status),
                      ).length
                    }
                  </strong>
                  <span>Durable background planning</span>
                </article>
              </section>
              {next ? (
                <section className="live-priority">
                  <div>
                    <small>NEXT BEST SEO INVESTMENT</small>
                    <h2>{next.keyword}</h2>
                    <p>{next.reason}</p>
                    <span>
                      {projectNames[next.projectId]} · Current rank{" "}
                      {next.currentRank
                        ? `#${next.currentRank}`
                        : "not ranking yet"}{" "}
                      · Target #{next.targetRank}
                      {next.estimatedMonthlyValue != null
                        ? ` · Est. search value $${next.estimatedMonthlyValue.toLocaleString()}/mo`
                        : ""}
                    </span>
                  </div>
                  <aside>
                    <strong>{next.score}</strong>
                    <small>VALUE SCORE</small>
                    {can("seo.write") && (
                      <button
                        onClick={() => {
                          setTab("Packages");
                          setDialog(`package:${next.id}`);
                        }}
                      >
                        Prepare action
                      </button>
                    )}
                  </aside>
                </section>
              ) : (
                <Empty
                  title={
                    scopedProjects.length
                      ? "Ready to discover the best local keywords"
                      : "Add your first client"
                  }
                  body={
                    scopedProjects.length
                      ? "HD SEO will use the configured service areas to find and prioritize geographically relevant opportunities."
                      : "Add a client domain first. No keyword list is required."
                  }
                  action={() =>
                    scopedProjects.length
                      ? setDialog("discovery")
                      : setTab("Onboarding")
                  }
                />
              )}
              <section className="live-section">
                <h2>Recent activity</h2>
                {data.events
                  .filter(
                    (item) =>
                      !selectedClient ||
                      item.title
                        .toLowerCase()
                        .includes(selectedClient.name.toLowerCase()),
                  )
                  .slice(0, 5)
                  .map((item) => (
                    <article className="live-row" key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                      </div>
                      <small>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </small>
                    </article>
                  ))}
              </section>
            </>
          )}
          {tab === "Agent Workspace" && (
            <AgentWorkspace
              projects={scopedProjects}
              canRun={can("seo.write")}
              canApprove={can("execution.approve")}
            />
          )}{" "}
          {tab === "Local Growth" && (
            <LocalGrowthEngine
              projects={scopedProjects}
              canWrite={can("seo.write")}
              canApprove={can("draft.approve")}
            />
          )}{" "}
          {tab === "Creative Studio" && (
            <CreativeStudio
              projects={scopedProjects}
              canWrite={can("seo.write")}
              canApprove={can("draft.approve")}
            />
          )}
          {tab === "Onboarding" && (
            <ClientOnboardingWizard
              data={data}
              initialProjectId={initialOnboardingProjectId}
              initialStep={initialOnboardingStep}
              onData={(nextData, nextMessage) => {
                setData(nextData as Data);
                setMessage(nextMessage);
                window.setTimeout(() => setMessage(""), 6500);
              }}
              onOpenWebsites={() => setTab("Websites")}
            />
          )}
          {tab === "Clients" && (
            <>
              <div className="live-heading client-first-heading">
                <div>
                  <small>CLIENT PORTFOLIO</small>
                  <h1>
                    {selectedClient
                      ? selectedClient.name
                      : "Choose a client to work on"}
                  </h1>
                  <p>
                    {selectedClient
                      ? `${selectedClient.domain} · ${selectedClient.contactEmail || "No client approver assigned"}`
                      : "Clients needing action appear first. Select one to focus every workspace view on that business."}
                  </p>
                </div>
                {selectedClient ? (
                  <button onClick={() => setTab("Overview")}>
                    Open client workspace →
                  </button>
                ) : can("clients.manage") ? (
                  <button onClick={() => setTab("Onboarding")}>
                    ＋ Add client
                  </button>
                ) : null}
              </div>
              <AgencyClientCommandCenter
                clients={data.clients}
                projects={data.projects}
                opportunities={visibleOpportunities}
                tasks={data.tasks}
                packages={data.packages}
                jobs={data.jobs}
                websites={data.websites}
                canManageClients={can("clients.manage")}
                selectedClientId={selectedClientId}
                onAddClient={() => setTab("Onboarding")}
                onSelectClient={(clientId) => setSelectedClientId(clientId)}
                onOpenClients={(clientId) => {
                  if (clientId) setSelectedClientId(clientId);
                }}
                onOpenApprovals={(clientId) =>
                  openClientTab(clientId, "Approvals")
                }
                onOpenOpportunities={(clientId) =>
                  openClientTab(clientId, "Opportunities")
                }
              />
              {selectedClient && (
                <section className="selected-client-actions">
                  <div>
                    <small>WORK ON {selectedClient.name.toUpperCase()}</small>
                    <strong>Client workspace selected</strong>
                    <span>
                      All views below are now scoped to this client until you
                      choose “All clients.”
                    </span>
                  </div>
                  <nav>
                    <button onClick={() => setTab("Overview")}>Overview</button>
                    <button onClick={() => setTab("Approvals")}>
                      Approvals{" "}
                      <b>
                        {
                          scopedPackages.filter((item) =>
                            [
                              "agency_review",
                              "awaiting_agency_review",
                              "client_review",
                              "awaiting_client",
                            ].includes(item.status),
                          ).length
                        }
                      </b>
                    </button>
                    <button onClick={() => setTab("Opportunities")}>
                      Opportunities{" "}
                      <b>
                        {
                          scopedOpportunities.filter(
                            (item) =>
                              item.status === "open" && item.score >= 50,
                          ).length
                        }
                      </b>
                    </button>
                    <button onClick={() => setTab("Work queue")}>
                      Work queue{" "}
                      <b>
                        {
                          scopedTasks.filter(
                            (item) =>
                              !["completed", "cancelled"].includes(item.status),
                          ).length
                        }
                      </b>
                    </button>
                    <button onClick={() => setTab("Websites")}>Website</button>
                  </nav>
                </section>
              )}
            </>
          )}
          {tab === "Approvals" && (
            <section className="live-section agency-approval-queue">
              <div className="live-section-head">
                <div>
                  <h1>
                    {selectedClient
                      ? `${selectedClient.name} approvals`
                      : "Approvals across all clients"}
                  </h1>
                  <p>
                    Agency decisions, client decisions, and approved campaigns
                    ready for the next step.
                  </p>
                </div>
              </div>
              {scopedPackages.filter((item) =>
                [
                  "agency_review",
                  "awaiting_agency_review",
                  "approved",
                  "client_review",
                  "awaiting_client",
                  "client_approved",
                ].includes(item.status),
              ).length ? (
                scopedPackages
                  .filter((item) =>
                    [
                      "agency_review",
                      "awaiting_agency_review",
                      "approved",
                      "client_review",
                      "awaiting_client",
                      "client_approved",
                    ].includes(item.status),
                  )
                  .map((item) => (
                    <article className="live-package" key={item.id}>
                      <div>
                        <small>
                          {projectNames[item.projectId]} ·{" "}
                          {item.status.replaceAll("_", " ")}
                        </small>
                        <h2>{item.title}</h2>
                        <p>
                          {item.packageData?.metadata?.metaDescription ??
                            "Review the evidence, proposed action, and next implementation step."}
                        </p>
                      </div>
                      <div className="package-actions">
                        {["agency_review", "awaiting_agency_review"].includes(
                          item.status,
                        ) &&
                          can("draft.approve") && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act({
                                  action: "approve_package",
                                  packageId: item.id,
                                })
                              }
                            >
                              Approve for client
                            </button>
                          )}
                        {item.status === "approved" &&
                          can("client_portal.manage") && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act({
                                  action: "publish_package",
                                  packageId: item.id,
                                })
                              }
                            >
                              Send to client
                            </button>
                          )}
                        {["client_review", "awaiting_client"].includes(
                          item.status,
                        ) && <em>Waiting for client</em>}
                        {item.status === "client_approved" &&
                          item.packageData.delivery?.mode === "direct_cms" &&
                          can("execution.approve") && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act({
                                  action: "publish_cms",
                                  packageId: item.id,
                                })
                              }
                            >
                              Publish to{" "}
                              {item.packageData.delivery?.provider ?? "website"}
                            </button>
                          )}
                        {item.status === "client_approved" &&
                          (can("seo.write") || can("execution.edit")) && (
                            <button
                              onClick={() => setDialog(`implement:${item.id}`)}
                            >
                              Record manual implementation
                            </button>
                          )}
                        <button onClick={() => setDialog(`details:${item.id}`)}>
                          View details
                        </button>
                      </div>
                    </article>
                  ))
              ) : (
                <Empty
                  title="No approvals are waiting"
                  body="New campaign and client decisions will appear here automatically."
                />
              )}
            </section>
          )}
          {tab === "Websites" && (
            <WebsiteConnections
              agencyId={data.agency.id}
              projects={scopedProjects}
              websites={scopedWebsites}
              canManage={can("integrations.manage")}
              busy={busy}
              onAction={act}
              onOpenPackages={() => setTab("Packages")}
            />
          )}
          {tab === "Opportunities" && (
            <section className="live-section">
              <div className="live-section-head">
                <div>
                  <h1>
                    {selectedClient
                      ? `${selectedClient.name} opportunities`
                      : "Best-value keyword opportunities"}
                  </h1>
                  <p>
                    Only service-area-relevant keywords are shown, scored
                    against local demand, CPC, difficulty, rank proximity, and
                    budget.
                  </p>
                </div>
                {can("provider.authorize") && (
                  <button
                    disabled={!scopedProjects.length || busy}
                    onClick={() => setDialog("discovery")}
                  >
                    ✦ Run local discovery
                  </button>
                )}
              </div>
              {scopedOpportunities.length ? (
                scopedOpportunities.map((item) => (
                  <article className="live-row opportunity-live" key={item.id}>
                    <b>{item.score}</b>
                    <div>
                      <strong>{item.keyword}</strong>
                      <span>
                        {projectNames[item.projectId]} · {item.actionType} ·
                        Rank{" "}
                        {item.currentRank
                          ? `#${item.currentRank}`
                          : "unavailable"}{" "}
                        → #{item.targetRank}
                        {item.searchVolume != null
                          ? ` · ${item.searchVolume.toLocaleString()} local-market searches`
                          : ""}
                        {item.cpc != null
                          ? ` · $${item.cpc.toFixed(2)} CPC`
                          : ""}
                        {item.difficulty != null
                          ? ` · Difficulty ${item.difficulty}`
                          : ""}
                      </span>
                      <p>{item.reason}</p>
                      {item.estimatedMonthlyValue != null && (
                        <small>
                          Directional monthly search value: $
                          {item.estimatedMonthlyValue.toLocaleString()} ·
                          Estimated effort: $
                          {item.estimatedEffort?.toLocaleString() ?? "—"} ·
                          Value/effort: {item.valuePerDollar?.toFixed(2) ?? "—"}
                        </small>
                      )}
                    </div>
                    {can("seo.write") && (
                      <button
                        onClick={() => {
                          setTab("Packages");
                          setDialog(`package:${item.id}`);
                        }}
                      >
                        Prepare action
                      </button>
                    )}
                  </article>
                ))
              ) : (
                <Empty
                  title="No local discovery results yet"
                  body="Run discovery—HD SEO will use this client's configured service areas and automatically exclude explicit out-of-area searches."
                  action={
                    can("provider.authorize")
                      ? () => setDialog("discovery")
                      : undefined
                  }
                />
              )}
            </section>
          )}
          {tab === "Automation" && (
            <section className="live-section">
              <div className="live-section-head">
                <div>
                  <h1>Autonomous planning runs</h1>
                  <p>
                    Durable background runs turn discovered evidence into a
                    ranked recommendation and review-ready implementation plan.
                  </p>
                </div>
                {can("provider.authorize") && (
                  <button
                    disabled={!scopedProjects.length || busy}
                    onClick={() => setDialog("discovery")}
                  >
                    ✦ Find and plan next action
                  </button>
                )}
              </div>
              {scopedJobs.length ? (
                scopedJobs.map((job) => {
                  const finished = [
                    "completed",
                    "cancelled",
                    "failed",
                    "stale",
                  ].includes(job.status);
                  return (
                    <article className="live-row automation-run" key={job.id}>
                      <div>
                        <strong>
                          {projectNames[job.projectId] ?? "SEO project"}
                        </strong>
                        <span>
                          {job.status.replaceAll("_", " ")} ·{" "}
                          {job.currentStage.replaceAll("_", " ")} ·{" "}
                          {job.progressPercent}%
                        </span>
                        {job.errorMessage && <p>{job.errorMessage}</p>}
                        <small>
                          Reference {job.referenceId.slice(0, 8)} · Updated{" "}
                          {new Date(job.updatedAt).toLocaleString()}
                        </small>
                      </div>
                      <div className="package-actions">
                        {job.status === "awaiting_opportunity_review" &&
                          can("draft.approve") && (
                            <>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void act({
                                    action: "review_job",
                                    jobId: job.id,
                                    decision: "dismiss",
                                  })
                                }
                              >
                                Dismiss
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void act({
                                    action: "review_job",
                                    jobId: job.id,
                                    decision: "proceed",
                                  })
                                }
                              >
                                Prepare package
                              </button>
                            </>
                          )}
                        {can("execution.approve") &&
                          !finished &&
                          job.status !== "awaiting_opportunity_review" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act({
                                  action: "control_job",
                                  jobId: job.id,
                                  command: "cancel",
                                })
                              }
                            >
                              Cancel
                            </button>
                          )}
                        {can("execution.approve") &&
                          ["failed", "stale"].includes(job.status) && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act({
                                  action: "control_job",
                                  jobId: job.id,
                                  command: "retry",
                                })
                              }
                            >
                              Retry safely
                            </button>
                          )}
                      </div>
                    </article>
                  );
                })
              ) : (
                <Empty
                  title="No automation runs yet"
                  body="Run automatic discovery. HD SEO will queue a durable planning run without asking you to supply keywords."
                  action={
                    can("provider.authorize")
                      ? () => setDialog("discovery")
                      : undefined
                  }
                />
              )}
            </section>
          )}
          {tab === "Work queue" && (
            <section className="live-section">
              <div className="live-section-head">
                <div>
                  <h1>Work queue</h1>
                  <p>Assigned implementation tasks with persistent status.</p>
                </div>
              </div>
              {scopedTasks.map((item) => (
                <article className="live-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {projectNames[item.projectId]} ·{" "}
                      {item.implementationPath?.replaceAll("_", " ")}
                    </span>
                  </div>
                  <select
                    value={item.status}
                    disabled={
                      busy || !(can("task.manage") || can("task.update"))
                    }
                    onChange={(event) =>
                      void act({
                        action: "update_task",
                        taskId: item.id,
                        status: event.target.value,
                      })
                    }
                  >
                    <option>ready</option>
                    <option>in_progress</option>
                    <option>awaiting_review</option>
                    <option>completed</option>
                    <option>blocked</option>
                  </select>
                </article>
              ))}
            </section>
          )}
          {tab === "Packages" && (
            <section className="live-section">
              <div className="live-section-head">
                <div>
                  <h1>Implementation packages</h1>
                  <p>
                    Evidence-safe WordPress, Shopify, Webflow, and developer
                    workflows with rollback protection.
                  </p>
                </div>
              </div>
              {scopedPackages.length ? (
                scopedPackages.map((item) => (
                  <article className="live-package" key={item.id}>
                    <div>
                      <small>
                        {item.packageData.delivery?.label ??
                          item.implementationPath.replaceAll("_", " ")} ·{" "}
                        {item.status.replaceAll("_", " ")}
                        {item.publicationProvider
                          ? ` · ${item.publicationProvider} ${item.publicationStatus?.replaceAll("_", " ")}`
                          : ""}
                      </small>
                      <h2>{item.title}</h2>
                      <p>
                        {item.packageData?.metadata?.title ??
                          "Implementation details ready for accountable review."}
                      </p>
                      <div className="package-meta">
                        <span>
                          Acceptance checks:{" "}
                          {item.packageData?.acceptanceCriteria?.length ?? 0}
                        </span>
                        <span>
                          Verification checks:{" "}
                          {item.packageData?.verificationChecklist?.length ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="package-actions">
                      {["agency_review", "awaiting_agency_review"].includes(
                        item.status,
                      ) &&
                        can("draft.approve") && (
                          <button
                            onClick={() =>
                              void act({
                                action: "approve_package",
                                packageId: item.id,
                              })
                            }
                          >
                            Approve package
                          </button>
                        )}
                      {item.status === "approved" &&
                        can("client_portal.manage") && (
                          <button
                            onClick={() =>
                              void act({
                                action: "publish_package",
                                packageId: item.id,
                              })
                            }
                          >
                            Send to client
                          </button>
                        )}
                      {item.status === "client_approved" &&
                        item.packageData.delivery?.mode === "direct_cms" &&
                        can("execution.approve") && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act({
                                action: "publish_cms",
                                packageId: item.id,
                              })
                            }
                          >
                            Publish to{" "}
                            {item.packageData.delivery?.provider ?? "website"}
                          </button>
                        )}
                      {item.status === "client_approved" &&
                        (can("seo.write") || can("execution.edit")) && (
                          <button
                            onClick={() => setDialog(`implement:${item.id}`)}
                          >
                            Record manual implementation
                          </button>
                        )}
                      {["implemented", "implemented_unverified"].includes(
                        item.status,
                      ) &&
                        can("execution.approve") && (
                          <button
                            onClick={() => setDialog(`verify:${item.id}`)}
                          >
                            Verify completion
                          </button>
                        )}
                      {item.publicationId &&
                        item.publicationStatus === "published" &&
                        can("deploy.rollback") && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Restore this page to its exact pre-publication snapshot?",
                                )
                              )
                                void act({
                                  action: "rollback_cms",
                                  packageId: item.id,
                                  publicationId: item.publicationId,
                                  confirm: true,
                                });
                            }}
                          >
                            Roll back CMS change
                          </button>
                        )}
                      <button onClick={() => setDialog(`details:${item.id}`)}>
                        View package
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <Empty
                  title="No implementation packages"
                  body="Choose an opportunity and create a professional manual implementation package."
                  action={
                    can("seo.write") ? () => setTab("Opportunities") : undefined
                  }
                />
              )}
            </section>
          )}
          {tab === "Activity" && (
            <section className="live-section">
              <div className="live-section-head">
                <div>
                  <h1>Proof of work</h1>
                  <p>
                    An attributable timeline of real actions completed in HD
                    SEO.
                  </p>
                </div>
              </div>
              {data.events.map((item) => (
                <article className="live-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </div>
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                </article>
              ))}
            </section>
          )}
        </div>
      </section>
      {dialog && (
        <LiveDialog
          kind={dialog}
          projects={scopedProjects.length ? scopedProjects : data.projects}
          packages={scopedPackages.length ? scopedPackages : data.packages}
          opportunities={data.opportunities}
          websites={data.websites}
          implementationReadiness={data.implementationReadiness}
          selectedProjectId={
            scopedProjects.length === 1 ? scopedProjects[0].id : null
          }
          close={() => setDialog(null)}
          openConnections={() => {
            setDialog(null);
            setTab("Websites");
          }}
          submit={form}
          busy={busy}
          message={message}
        />
      )}
    </main>
  );
}
function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: () => void;
}) {
  return (
    <div className="live-empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action && <button onClick={action}>Get started →</button>}
    </div>
  );
}
function LiveDialog({
  kind,
  projects,
  packages,
  opportunities,
  websites,
  implementationReadiness,
  selectedProjectId,
  close,
  openConnections,
  submit,
  busy,
  message,
}: {
  kind: string;
  projects: Project[];
  packages: Package[];
  opportunities: Opportunity[];
  websites: Website[];
  implementationReadiness: ImplementationReadiness[];
  selectedProjectId: string | null;
  close: () => void;
  openConnections: () => void;
  submit: (
    event: FormEvent<HTMLFormElement>,
    action: string,
    transform?: (data: FormData) => Record<string, unknown>,
  ) => void;
  busy: boolean;
  message: string;
}) {
  const packageId = kind.includes(":") ? kind.split(":")[1] : null,
    pkg = packages.find((item) => item.id === packageId),
    packageOpportunity = kind.startsWith("package:")
      ? opportunities.find((item) => item.id === packageId)
      : null,
    packageProject = packageOpportunity
      ? projects.find((item) => item.id === packageOpportunity.projectId)
      : null,
    packageWebsite = packageProject
      ? websites.find((item) => item.projectId === packageProject.id)
      : null,
    packageReadiness = packageProject
      ? implementationReadiness.find(
          (item) => item.projectId === packageProject.id,
        )
      : null;
  const [discoveryProjectId, setDiscoveryProjectId] = useState(
    selectedProjectId ?? projects[0]?.id ?? "",
  );
  const discoveryProject =
    projects.find((item) => item.id === discoveryProjectId) ?? projects[0];
  const implementationOptions = buildImplementationOptions(
    packageReadiness ?? null,
    packageWebsite ?? null,
  );
  const recommendedChoice =
    implementationOptions.find((item) => item.recommended && item.available) ??
    implementationOptions.find((item) => item.available);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal workflow-modal live-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={close}>
          ×
        </button>
        {kind === "client" && (
          <>
            <small>NEW CLIENT</small>
            <h2>Add a live client</h2>
            <p>
              This creates the client and its primary SEO project. You will not
              need to supply a keyword list.
            </p>
            <form
              className="workflow-form"
              onSubmit={(event) => submit(event, "create_client")}
            >
              <label>
                Client name
                <input name="name" required />
              </label>
              <label>
                Domain
                <input name="domain" placeholder="example.com" required />
              </label>
              <label>
                Client approver email
                <input
                  name="contactEmail"
                  type="email"
                  placeholder="client@example.com"
                />
              </label>
              <button disabled={busy}>Create client</button>
            </form>
          </>
        )}
        {kind === "discovery" && (
          <>
            <small>KEYWORD DISCOVERY</small>
            <h2>Find the best SEO investments</h2>
            <p>
              Choose whether this client serves the whole country or specific
              locations. HD SEO applies that scope to every discovered keyword.
            </p>
            <form
              className="workflow-form"
              onSubmit={(event) =>
                submit(event, "discover_keywords", (data) => ({
                  projectId: String(data.get("projectId")),
                  marketScope: String(data.get("marketScope")),
                  monthlyBudget: Number(data.get("monthlyBudget")),
                  limit: Number(data.get("limit")),
                }))
              }
            >
              <label>
                Client project
                <select
                  name="projectId"
                  value={discoveryProjectId}
                  onChange={(event) => setDiscoveryProjectId(event.target.value)}
                  required
                >
                  {projects.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.domain}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Customer market
                <select
                  key={discoveryProject?.id}
                  name="marketScope"
                  defaultValue={discoveryProject?.marketScope ?? "service_area"}
                >
                  <option value="service_area">Specific service areas</option>
                  <option value="nationwide">Nationwide · United States</option>
                </select>
              </label>
              <label>
                Monthly SEO budget
                <input
                  name="monthlyBudget"
                  type="number"
                  min="100"
                  step="100"
                  defaultValue="1500"
                  required
                />
              </label>
              <label>
                Discovery depth
                <select name="limit" defaultValue="50">
                  <option value="25">
                    Focused · up to 25 records per source
                  </option>
                  <option value="50">
                    Balanced · up to 50 records per source
                  </option>
                  <option value="100">
                    Deep · up to 100 records per source
                  </option>
                </select>
              </label>
              <div className="discovery-note">
                <strong>Geographic enforcement is automatic</strong>
                <p>
                  Specific service areas exclude explicit out-of-area searches.
                  Nationwide accepts demand throughout the United States. The
                  selection is saved for future research and actual provider
                  cost remains budget-capped and recorded.
                </p>
              </div>
              <button disabled={busy}>
                {busy
                  ? "Analyzing keywords, rankings, and value…"
                  : "Discover opportunities"}
              </button>
            </form>
          </>
        )}
        {kind === "opportunity" && (
          <>
            <small>OPTIONAL MANUAL OVERRIDE</small>
            <h2>Add a known opportunity</h2>
            <p>
              Use this only when you already have verified evidence that is not
              available through connected data sources.
            </p>
            <form
              className="workflow-form"
              onSubmit={(event) =>
                submit(event, "create_opportunity", (data) => ({
                  projectId: String(data.get("projectId")),
                  keyword: String(data.get("keyword")),
                  currentRank: Number(data.get("currentRank")) || undefined,
                  targetRank: Number(data.get("targetRank")),
                  actionType: String(data.get("actionType")),
                  reason: String(data.get("reason")),
                }))
              }
            >
              <label>
                Project
                <select
                  name="projectId"
                  defaultValue={selectedProjectId ?? undefined}
                  required
                >
                  {projects.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.domain}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Keyword
                <input name="keyword" required />
              </label>
              <div className="form-grid">
                <label>
                  Current rank
                  <input name="currentRank" type="number" min="1" max="100" />
                </label>
                <label>
                  Target rank
                  <input
                    name="targetRank"
                    type="number"
                    min="1"
                    max="20"
                    defaultValue="10"
                    required
                  />
                </label>
              </div>
              <label>
                Action type
                <select name="actionType">
                  <option>IMPROVE</option>
                  <option>BUILD</option>
                  <option>TECHNICAL</option>
                  <option>LINK</option>
                  <option>LOCALIZE</option>
                  <option>CONTENT</option>
                  <option>MAPS</option>
                  <option>CTR_WIN</option>
                </select>
              </label>
              <label>
                Evidence-based reason
                <textarea
                  name="reason"
                  minLength={10}
                  required
                  placeholder="Explain why this work should be prioritized using known evidence."
                />
              </label>
              <button disabled={busy}>Score manual opportunity</button>
            </form>
          </>
        )}
        {kind.startsWith("package:") && (
          <>
            <small>IMPLEMENTATION PATH</small>
            <h2>How should HD SEO complete this work?</h2>
            <p>
              HD SEO recommends the safest available option for{" "}
              <strong>{packageProject?.name ?? "this client"}</strong>. Automatic
              paths remain approval-gated and include validation and rollback
              protection.
            </p>
            <form
              className="workflow-form implementation-choice-form"
              onSubmit={(event) =>
                submit(event, "create_package", (data) => ({
                  opportunityId: kind.split(":")[1],
                  implementationPath: String(data.get("implementationPath")),
                }))
              }
            >
              {(["automatic", "guided"] as const).map((group) => (
                <fieldset className="implementation-choice-group" key={group}>
                  <legend>
                    {group === "automatic"
                      ? "Automatic and connected"
                      : "Guided and manual"}
                  </legend>
                  <div className="implementation-choice-grid">
                    {implementationOptions
                      .filter((item) => item.group === group)
                      .map((item) => (
                        <div
                          className={`implementation-choice ${item.available ? "available" : "blocked"} ${item.recommended ? "recommended" : ""}`}
                          key={item.value}
                        >
                          <label>
                            <input
                              type="radio"
                              name="implementationPath"
                              value={item.value}
                              disabled={!item.available}
                              defaultChecked={
                                recommendedChoice?.value === item.value
                              }
                              required={item.available}
                            />
                            <span>
                              <strong>{item.title}</strong>
                              {item.recommended && item.available && (
                                <em>RECOMMENDED</em>
                              )}
                              <small>{item.description}</small>
                              {item.reason && <b>{item.reason}</b>}
                            </span>
                          </label>
                          {item.setup && (
                            <button type="button" onClick={openConnections}>
                              Finish setup
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                </fieldset>
              ))}
              <div className="implementation-safety-note">
                <strong>Nothing publishes immediately</strong>
                <span>
                  HD SEO prepares the work first. Client approval, validation,
                  spending limits, audit logging, and rollback rules still
                  apply.
                </span>
              </div>
              <button disabled={busy || !recommendedChoice}>
                {busy ? "Preparing workflow…" : "Use selected option"}
              </button>
            </form>
          </>
        )}
        {kind.startsWith("implement:") && pkg && (
          <>
            <small>IMPLEMENTATION PROOF</small>
            <h2>Record the live implementation</h2>
            <p>
              Save the exact live URL. HD SEO will require this evidence before
              verification and monitoring.
            </p>
            <form
              className="workflow-form"
              onSubmit={(event) =>
                submit(event, "mark_implemented", (data) => ({
                  packageId: pkg.id,
                  liveUrl: String(data.get("liveUrl")),
                  proof: { note: String(data.get("proofNote") || "") },
                }))
              }
            >
              <label>
                Live URL
                <input
                  name="liveUrl"
                  type="url"
                  placeholder="https://example.com/page"
                  required
                />
              </label>
              <label>
                Implementation note
                <textarea
                  name="proofNote"
                  placeholder="What changed, who implemented it, and where supporting proof is stored."
                />
              </label>
              <button disabled={busy}>Save implementation proof</button>
            </form>
          </>
        )}
        {kind.startsWith("verify:") && pkg && (
          <>
            <small>AUTOMATED LIVE VERIFICATION</small>
            <h2>Verify implementation</h2>
            <p>
              HD SEO fetches the live URL and independently compares HTTP
              status, approved metadata, H1, canonical, schema, internal links,
              robots directives, and indexing readiness. Monitoring starts only
              when every required check passes.
            </p>
            <form
              className="workflow-form"
              onSubmit={(event) =>
                submit(event, "verify_package", () => ({ packageId: pkg.id }))
              }
            >
              <div className="discovery-note">
                <strong>No self-attestation</strong>
                <p>
                  The result and page content hash are stored as verification
                  evidence. Failed checks remain available for correction and
                  retry.
                </p>
              </div>
              <button disabled={busy}>
                {busy
                  ? "Running independent live checks…"
                  : "Run automated verification"}
              </button>
            </form>
          </>
        )}
        {kind.startsWith("details:") && pkg && (
          <>
            <small>
              {pkg.packageData.delivery?.label ??
                pkg.implementationPath.replaceAll("_", " ")}
            </small>
            <h2>{pkg.title}</h2>
            <div className="package-details">
              <strong>Metadata</strong>
              <p>{pkg.packageData?.metadata?.title}</p>
              <p>{pkg.packageData?.metadata?.metaDescription}</p>
              <strong>Acceptance criteria</strong>
              <ul>
                {pkg.packageData?.acceptanceCriteria?.map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <strong>Verification checklist</strong>
              <ul>
                {pkg.packageData?.verificationChecklist?.map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        )}
        {message && <div className="login-message">{message}</div>}
      </div>
    </div>
  );
}
