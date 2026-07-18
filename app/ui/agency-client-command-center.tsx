"use client";

type Client = { id: string; name: string; domain: string; status: string };
type Project = { id: string; clientId: string; name: string; status: string };
type Opportunity = {
  id: string;
  projectId: string;
  keyword: string;
  score: number;
  status: string;
  reason: string;
  estimatedMonthlyValue: number | null;
};
type Task = { id: string; projectId: string; title: string; status: string };
type Package = { id: string; projectId: string; title: string; status: string };
type Job = {
  id: string;
  projectId: string;
  status: string;
  progressPercent: number;
};
type Website = {
  projectId: string;
  connectionStatus: string | null;
  status: string;
};

type Props = {
  clients: Client[];
  projects: Project[];
  opportunities: Opportunity[];
  tasks: Task[];
  packages: Package[];
  jobs: Job[];
  websites: Website[];
  canManageClients: boolean;
  selectedClientId?: string | null;
  onAddClient: () => void;
  onSelectClient: (clientId: string) => void;
  onOpenClients: (clientId?: string) => void;
  onOpenApprovals: (clientId?: string) => void;
  onOpenOpportunities: (clientId?: string) => void;
};

const agencyApprovalStatuses = new Set([
  "agency_review",
  "awaiting_agency_review",
]);
const clientApprovalStatuses = new Set(["client_review", "awaiting_client"]);
const activeJobStatuses = new Set([
  "queued",
  "running",
  "processing",
  "awaiting_opportunity_review",
]);

export function AgencyClientCommandCenter({
  clients,
  projects,
  opportunities,
  tasks,
  packages,
  jobs,
  websites,
  canManageClients,
  selectedClientId,
  onAddClient,
  onSelectClient,
  onOpenClients,
  onOpenApprovals,
  onOpenOpportunities,
}: Props) {
  const projectByClient = new Map(
    projects.map((project) => [project.clientId, project]),
  );
  const summaries = clients.map((client) => {
    const project = projectByClient.get(client.id);
    const projectId = project?.id;
    const clientPackages = packages.filter(
      (item) => item.projectId === projectId,
    );
    const clientTasks = tasks.filter((item) => item.projectId === projectId);
    const clientJobs = jobs.filter((item) => item.projectId === projectId);
    const clientOpportunities = opportunities
      .filter((item) => item.projectId === projectId && item.status === "open")
      .sort((a, b) => b.score - a.score);
    const agencyApprovals = clientPackages.filter((item) =>
      agencyApprovalStatuses.has(item.status),
    );
    const clientApprovals = clientPackages.filter((item) =>
      clientApprovalStatuses.has(item.status),
    );
    const campaignReady = clientJobs.filter(
      (item) => item.status === "awaiting_opportunity_review",
    ).length;
    const activeCampaigns = clientJobs.filter((item) =>
      activeJobStatuses.has(item.status),
    ).length;
    const blockedTasks = clientTasks.filter(
      (item) => item.status === "blocked",
    ).length;
    const openTasks = clientTasks.filter(
      (item) => !["completed", "cancelled"].includes(item.status),
    ).length;
    const topOpportunity = clientOpportunities[0] ?? null;
    const website = websites.find((item) => item.projectId === projectId);
    const connected = Boolean(
      website &&
        (website.connectionStatus === "connected" ||
          website.status === "connected"),
    );
    const attention =
      agencyApprovals.length +
      clientApprovals.length +
      campaignReady +
      blockedTasks +
      (topOpportunity && topOpportunity.score >= 50 ? 1 : 0) +
      (!connected ? 1 : 0);
    return {
      client,
      project,
      agencyApprovals,
      clientApprovals,
      campaignReady,
      activeCampaigns,
      blockedTasks,
      openTasks,
      topOpportunity,
      connected,
      attention,
    };
  }).sort(
    (a, b) =>
      b.attention - a.attention ||
      a.client.name.localeCompare(b.client.name),
  );

  const totalApprovals = summaries.reduce(
    (sum, item) =>
      sum + item.agencyApprovals.length + item.clientApprovals.length,
    0,
  );
  const readyCampaigns = summaries.reduce(
    (sum, item) => sum + item.campaignReady,
    0,
  );
  const highValueOpportunities = opportunities.filter(
    (item) => item.status === "open" && item.score >= 50,
  ).length;
  const clientsNeedingAttention = summaries.filter(
    (item) => item.attention > 0,
  ).length;

  const actionItems = summaries
    .flatMap((summary) => {
      const items: Array<{
        key: string;
        level: string;
        title: string;
        detail: string;
        action: () => void;
        weight: number;
      }> = [];
      if (summary.agencyApprovals.length) {
        items.push({
          key: `${summary.client.id}:agency-approval`,
          level: "APPROVAL",
          title: `${summary.client.name} is waiting on your approval`,
          detail: `${summary.agencyApprovals.length} campaign package${summary.agencyApprovals.length === 1 ? "" : "s"} ready for agency review.`,
          action: () => onOpenApprovals(summary.client.id),
          weight: 100,
        });
      }
      if (summary.clientApprovals.length) {
        items.push({
          key: `${summary.client.id}:client-approval`,
          level: "CLIENT",
          title: `${summary.client.name} has a decision pending`,
          detail: `${summary.clientApprovals.length} recommendation${summary.clientApprovals.length === 1 ? " is" : "s are"} with the client.`,
          action: () => onOpenApprovals(summary.client.id),
          weight: 90,
        });
      }
      if (summary.campaignReady) {
        items.push({
          key: `${summary.client.id}:campaign`,
          level: "CAMPAIGN READY",
          title: `${summary.client.name} has a campaign ready`,
          detail:
            "Research is complete and the next action is ready to review.",
          action: () => onOpenOpportunities(summary.client.id),
          weight: 80,
        });
      }
      if (summary.topOpportunity && summary.topOpportunity.score >= 50) {
        items.push({
          key: `${summary.client.id}:opportunity`,
          level: "HIGH-VALUE OPPORTUNITY",
          title: summary.topOpportunity.keyword,
          detail: `${summary.client.name} · score ${summary.topOpportunity.score}${summary.topOpportunity.estimatedMonthlyValue ? ` · $${summary.topOpportunity.estimatedMonthlyValue.toLocaleString()}/mo directional value` : ""}`,
          action: () => onOpenOpportunities(summary.client.id),
          weight: 70 + summary.topOpportunity.score / 100,
        });
      }
      if (!summary.connected) {
        items.push({
          key: `${summary.client.id}:connection`,
          level: "SETUP",
          title: `${summary.client.name} still needs website access`,
          detail: "Connect publishing access or choose monitoring-only mode.",
          action: () => onOpenClients(summary.client.id),
          weight: 60,
        });
      }
      return items;
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  if (!clients.length) {
    return (
      <section className="agency-client-command empty-command">
        <div>
          <small>CLIENT COMMAND CENTER</small>
          <h2>Add your first client</h2>
          <p>
            Each client gets its own website, opportunities, approvals,
            campaigns, and proof of work.
          </p>
        </div>
        {canManageClients && (
          <button onClick={onAddClient}>＋ Add client</button>
        )}
      </section>
    );
  }

  return (
    <section className="agency-command-layout">
      <div className="agency-client-command">
        <header>
          <div>
            <small>CLIENT COMMAND CENTER</small>
            <h2>Every client, one clear next step</h2>
            <p>
              See what is waiting, what is ready, and where the best opportunity
              belongs.
            </p>
          </div>
          <button onClick={() => onOpenClients()}>View all clients →</button>
        </header>
        <div className="agency-client-grid">
          {summaries.map((summary) => (
            <article
              className={`${summary.attention ? "needs-attention" : "on-track"}${selectedClientId === summary.client.id ? " selected-client" : ""}`}
              key={summary.client.id}
            >
              <div className="agency-client-card-head">
                <span>{summary.client.name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <strong>{summary.client.name}</strong>
                  <small>
                    {summary.client.domain ||
                      summary.project?.name ||
                      "Website setup pending"}
                  </small>
                </div>
                <em>
                  {summary.attention
                    ? `${summary.attention} NEEDS ACTION`
                    : "ON TRACK"}
                </em>
              </div>
              <dl>
                <div>
                  <dt>Approvals</dt>
                  <dd>
                    {summary.agencyApprovals.length +
                      summary.clientApprovals.length}
                  </dd>
                </div>
                <div>
                  <dt>Open work</dt>
                  <dd>{summary.openTasks}</dd>
                </div>
                <div>
                  <dt>Top score</dt>
                  <dd>{summary.topOpportunity?.score ?? "—"}</dd>
                </div>
              </dl>
              <div className="agency-client-signal">
                {summary.agencyApprovals.length > 0 ? (
                  <>
                    <b>Waiting for agency approval</b>
                    <span>{summary.agencyApprovals[0].title}</span>
                  </>
                ) : summary.clientApprovals.length > 0 ? (
                  <>
                    <b>Waiting for client</b>
                    <span>{summary.clientApprovals[0].title}</span>
                  </>
                ) : summary.campaignReady > 0 ? (
                  <>
                    <b>Campaign ready</b>
                    <span>Research and planning are complete.</span>
                  </>
                ) : summary.topOpportunity ? (
                  <>
                    <b>New opportunity</b>
                    <span>{summary.topOpportunity.keyword}</span>
                  </>
                ) : (
                  <>
                    <b>
                      {summary.connected
                        ? "Monitoring active"
                        : "Connection needed"}
                    </b>
                    <span>
                      {summary.connected
                        ? "HD SEO is watching this client."
                        : "Choose how HD SEO may access the website."}
                    </span>
                  </>
                )}
              </div>
              <button onClick={() => onSelectClient(summary.client.id)}>Work on this client →</button>
            </article>
          ))}
        </div>
      </div>

      <aside className="agency-action-feed">
        <header>
          <small>NEEDS ATTENTION</small>
          <strong>
            {clientsNeedingAttention} client
            {clientsNeedingAttention === 1 ? "" : "s"}
          </strong>
        </header>
        <div className="agency-action-summary">
          <button onClick={() => onOpenApprovals()}>
            <b>{totalApprovals}</b>
            <span>Approvals</span>
          </button>
          <button onClick={() => onOpenOpportunities()}>
            <b>{readyCampaigns + highValueOpportunities}</b>
            <span>Ready to act</span>
          </button>
        </div>
        <div className="agency-action-list">
          {actionItems.length ? (
            actionItems.map((item) => (
              <button key={item.key} onClick={item.action}>
                <small>{item.level}</small>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </button>
            ))
          ) : (
            <div className="agency-all-clear">
              <strong>Everything is moving</strong>
              <span>No client needs immediate attention.</span>
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}
