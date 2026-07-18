"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type User = { displayName: string; email: string };
type Client = { id: string; name: string; domain: string; status: string };
type ClientAccess = { client: Client; role: string };
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
  title: string;
  description: string | null;
  createdAt: string;
};
type ClientData = {
  clients: ClientAccess[];
  projects: Project[];
  opportunities: Opportunity[];
  packages: ClientPackage[];
  events: ClientEvent[];
};

const awaitingStatuses = new Set(["client_review", "awaiting_client"]);
const completedPackageStatuses = new Set([
  "implemented",
  "implemented_unverified",
  "verified",
]);

export function LiveClientBusinessDashboard({
  initialData,
  user,
}: {
  initialData: ClientData;
  user: User;
}) {
  const [data, setData] = useState(initialData);
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

  const companyData = useMemo(() => {
    const companyProjects = data.projects.filter(
      (project) => project.clientId === selectedClient?.id,
    );
    const projectIds = new Set(companyProjects.map((project) => project.id));
    const opportunities = data.opportunities
      .filter((item) => projectIds.has(item.projectId))
      .sort((a, b) => b.score - a.score);
    const packages = data.packages.filter((item) =>
      projectIds.has(item.projectId),
    );
    const events = data.events.filter(
      (item) => item.projectId === null || projectIds.has(item.projectId),
    );
    return { projects: companyProjects, opportunities, packages, events };
  }, [data, selectedClient?.id]);

  const approvals = companyData.packages.filter((item) =>
    awaitingStatuses.has(item.status),
  );
  const completed = companyData.packages.filter((item) =>
    completedPackageStatuses.has(item.status),
  );
  const topOpportunity = companyData.opportunities[0] ?? null;

  async function decide(packageId: string, decision: string) {
    setBusyId(packageId);
    setMessage("");
    try {
      const response = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "package_decision",
          packageId,
          decision,
        }),
      });
      const result = await response.json();
      if (response.ok) {
        setData(result.data);
        setMessage(
          decision === "client_approved"
            ? "Approved. Your SEO team can move forward."
            : "Your requested changes were sent to the SEO team.",
        );
      } else {
        setMessage(result.error?.message ?? "The decision could not be saved.");
      }
    } catch {
      setMessage("The decision could not be saved. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="live-role-page client-business-portal">
      <header>
        <Link className="role-brand" href="/">
          <span className="login-mark">
            <i />
            <b />
          </span>
          <span>
            HD <em>SEO</em>
          </span>
        </Link>
        <div>
          <span>{user.displayName}</span>
          <a href="/api/auth/signout">Sign out</a>
        </div>
      </header>
      <section className="client-business-content">
        {!data.clients.length ? (
          <div className="live-empty client-access-empty">
            <strong>No business access assigned</strong>
            <p>
              Ask your SEO provider to add {user.email} as an owner or approver.
            </p>
          </div>
        ) : (
          <>
            <div className="client-company-bar">
              <div>
                <small>YOUR BUSINESSES</small>
                <strong>
                  {data.clients.length === 1
                    ? "Your SEO dashboard"
                    : "Choose a company"}
                </strong>
              </div>
              <div className="client-company-switcher">
                {data.clients.map((item) => (
                  <button
                    className={
                      item.client.id === selectedClient?.id ? "active" : ""
                    }
                    key={item.client.id}
                    onClick={() => setSelectedClientId(item.client.id)}
                  >
                    <span>{item.client.name.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <strong>{item.client.name}</strong>
                      <small>{item.client.domain}</small>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="client-business-heading">
              <div>
                <small>CLIENT PORTAL</small>
                <h1>{selectedClient?.name}</h1>
                <p>
                  See what is working, what needs your decision, and what HD SEO
                  recommends next.
                </p>
              </div>
              <em>
                {selectedClient?.status === "active"
                  ? "SEO ACTIVE"
                  : selectedClient?.status?.replaceAll("_", " ")}
              </em>
            </div>
            {message && (
              <div className="live-saved client-message">✓ {message}</div>
            )}

            <section className="client-simple-metrics">
              <article>
                <small>NEEDS YOUR APPROVAL</small>
                <strong>{approvals.length}</strong>
                <span>
                  {approvals.length
                    ? "A quick decision keeps work moving"
                    : "Nothing is waiting on you"}
                </span>
              </article>
              <article>
                <small>TOP OPPORTUNITY SCORE</small>
                <strong>{topOpportunity?.score ?? "—"}</strong>
                <span>
                  {topOpportunity?.keyword ?? "Research is being prepared"}
                </span>
              </article>
              <article>
                <small>COMPLETED CHANGES</small>
                <strong>{completed.length}</strong>
                <span>Published or verified work</span>
              </article>
              <article>
                <small>PROGRESS UPDATES</small>
                <strong>{companyData.events.length}</strong>
                <span>Visible proof of work</span>
              </article>
            </section>

            {approvals.length > 0 ? (
              <section className="client-attention-card">
                <div>
                  <small>YOUR DECISION IS NEEDED</small>
                  <h2>{approvals[0].title}</h2>
                  <p>
                    {approvals[0].packageData?.metadata?.metaDescription ??
                      "Review this recommended SEO action before work continues."}
                  </p>
                </div>
                {canApprove && (
                  <div className="client-decision-actions">
                    <button
                      disabled={busyId === approvals[0].id}
                      onClick={() =>
                        void decide(approvals[0].id, "revision_requested")
                      }
                    >
                      Ask for changes
                    </button>
                    <button
                      disabled={busyId === approvals[0].id}
                      onClick={() =>
                        void decide(approvals[0].id, "client_approved")
                      }
                    >
                      {busyId === approvals[0].id
                        ? "Saving…"
                        : "Approve and continue →"}
                    </button>
                  </div>
                )}
              </section>
            ) : topOpportunity ? (
              <section className="client-opportunity-card">
                <div>
                  <small>BEST NEXT OPPORTUNITY</small>
                  <h2>{topOpportunity.keyword}</h2>
                  <p>{topOpportunity.reason}</p>
                  <span>
                    {topOpportunity.currentRank
                      ? `Currently #${topOpportunity.currentRank} · `
                      : "Not ranking yet · "}
                    Target #{topOpportunity.targetRank}
                  </span>
                </div>
                <aside>
                  <strong>{topOpportunity.score}</strong>
                  <small>VALUE SCORE</small>
                  {topOpportunity.estimatedMonthlyValue != null && (
                    <span>
                      ${topOpportunity.estimatedMonthlyValue.toLocaleString()}
                      /mo potential search value
                    </span>
                  )}
                </aside>
              </section>
            ) : (
              <section className="client-attention-card all-clear">
                <div>
                  <small>WORK IS MOVING</small>
                  <h2>No decision needed right now</h2>
                  <p>
                    Your SEO team will place the next important recommendation
                    here.
                  </p>
                </div>
              </section>
            )}

            <div className="client-business-grid">
              <section className="client-approval-list">
                <header>
                  <div>
                    <small>DECISIONS</small>
                    <h2>Recommendations for you</h2>
                  </div>
                  <span>{companyData.packages.length}</span>
                </header>
                {companyData.packages.length ? (
                  companyData.packages.map((item) => (
                    <article key={item.id}>
                      <div>
                        <em
                          className={
                            awaitingStatuses.has(item.status) ? "waiting" : ""
                          }
                        >
                          {awaitingStatuses.has(item.status)
                            ? "Needs approval"
                            : item.status.replaceAll("_", " ")}
                        </em>
                        <strong>{item.title}</strong>
                        <p>
                          {item.packageData?.metadata?.metaDescription ??
                            "SEO recommendation and implementation plan."}
                        </p>
                      </div>
                      {awaitingStatuses.has(item.status) && canApprove && (
                        <div>
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
                            onClick={() =>
                              void decide(item.id, "client_approved")
                            }
                          >
                            Approve
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="client-section-empty">
                    <strong>No recommendations to review</strong>
                    <span>
                      New recommendations will appear here when they are ready.
                    </span>
                  </div>
                )}
              </section>

              <section className="client-progress-list">
                <header>
                  <div>
                    <small>RESULTS &amp; ACTIVITY</small>
                    <h2>What has been done</h2>
                  </div>
                </header>
                {companyData.events.length ? (
                  companyData.events.slice(0, 8).map((item) => (
                    <article key={item.id}>
                      <span>✓</span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                      </div>
                      <small>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </small>
                    </article>
                  ))
                ) : (
                  <div className="client-section-empty">
                    <strong>Your timeline is getting started</strong>
                    <span>
                      Completed, client-visible work will appear here.
                    </span>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
