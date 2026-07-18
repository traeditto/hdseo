"use client";

import { useEffect, useMemo, useState } from "react";

type SetupProject = {
  id: string;
  clientId: string;
  name: string;
  domain: string;
};

type SetupState = {
  project: SetupProject;
  installation: {
    installationId: number;
    accountLogin: string;
    status: string;
  } | null;
  repository: {
    id: string;
    fullName: string;
    defaultBranch: string;
    providerId: number;
  } | null;
  vercelConnection: {
    id: string;
    accountType: string;
    teamId: string | null;
    teamSlug: string | null;
    lastVerifiedAt: string | null;
  } | null;
  vercelProject: {
    id: string;
    providerId: string;
    name: string;
    productionBranch: string;
    productionDomains: string[];
  } | null;
  readiness: {
    ready: boolean;
    blockers: string[];
    completedRequirements: string[];
    recommendedNextStep: string | null;
  };
  checks: {
    repositoryConnected: boolean;
    vercelConnectionActive: boolean;
    vercelProjectConnected: boolean;
    manualWorkflowVerified: boolean;
    automationEnabled: boolean;
    complete: boolean;
  };
};

const blockerLabels: Record<string, string> = {
  AGENCY_FEATURE_DISABLED: "Agency repository automation is awaiting activation.",
  PROJECT_FEATURE_DISABLED: "This client project is awaiting automation activation.",
  MANUAL_WORKFLOW_NOT_VERIFIED:
    "Complete and verify one safe manual change before enabling code execution.",
  REPOSITORY_NOT_VERIFIED: "The GitHub repository connection must be verified.",
  PROJECT_NOT_FOUND: "The selected client project could not be found.",
};

function projectSlug(project: SetupProject) {
  const value = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return value || project.domain.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function DeploymentSetupWizard({
  agencyId,
  project,
  onClose,
  onOpenPackages,
}: {
  agencyId: string;
  project: SetupProject;
  onClose: (refresh: boolean) => void;
  onOpenPackages: () => void;
}) {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [busy, setBusy] = useState<string | null>("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [existingProject, setExistingProject] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [deployment, setDeployment] = useState<{
    id: string;
    status: string;
    url?: string | null;
  } | null>(null);

  const scope = useMemo(
    () => ({ agencyId, clientId: project.clientId, projectId: project.id }),
    [agencyId, project.clientId, project.id],
  );

  async function load(showSpinner = true) {
    if (showSpinner) setBusy("loading");
    setError("");
    try {
      const query = new URLSearchParams(scope).toString();
      const response = await fetch(`/api/deployment/setup?${query}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Setup status could not be loaded.");
      setSetup(result.setup);
      return result.setup as SetupState;
    } catch (value) {
      setError(value instanceof Error ? value.message : "Setup status could not be loaded.");
      return null;
    } finally {
      if (showSpinner) setBusy(null);
    }
  }

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({
      agencyId,
      clientId: project.clientId,
      projectId: project.id,
    }).toString();
    fetch(`/api/deployment/setup?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "Setup status could not be loaded.");
        if (active) setSetup(result.setup);
      })
      .catch((value: unknown) => {
        if (active) setError(value instanceof Error ? value.message : "Setup status could not be loaded.");
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [agencyId, project.clientId, project.id]);

  async function post(path: string, body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "The setup action failed.");
      setChanged(true);
      return result;
    } catch (value) {
      setError(value instanceof Error ? value.message : "The setup action failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function connectAgencyVercel() {
    const result = await post(
      "/api/vercel/connect",
      { agencyId, usePlatformToken: true },
      "vercel-account",
    );
    if (!result) return;
    setMessage("Vercel account verified and connected.");
    await load(false);
  }

  async function connectVercelProject() {
    if (!setup?.repository || !setup.vercelConnection) return;
    const providerProject = existingProject.trim();
    const result = await post(
      "/api/vercel/connect",
      {
        ...scope,
        connectionId: setup.vercelConnection.id,
        repositoryId: setup.repository.id,
        projectName: projectSlug(project),
        ...(providerProject ? { vercelProjectId: providerProject } : {}),
        createIfMissing: !providerProject,
        productionDomains: [],
      },
      "vercel-project",
    );
    if (!result) return;
    setMessage(
      providerProject
        ? "Existing Vercel project connected."
        : "Vercel project found or created and connected.",
    );
    await load(false);
  }

  async function enableAutomation() {
    if (!setup?.repository) return;
    const result = await post(
      "/api/github/readiness",
      {
        ...scope,
        repositoryId: setup.repository.id,
        acknowledgeHumanApprovedExecution: true,
      },
      "automation",
    );
    if (!result) return;
    setMessage("Human-approved GitHub and Vercel automation is enabled.");
    await load(false);
  }

  async function testConnections() {
    const result = await post(
      "/api/deployment/setup",
      { ...scope, action: "test_connections" },
      "test",
    );
    if (!result) return;
    setMessage(
      `Verified ${result.test.github.repository} and Vercel project ${result.test.vercel.project}.`,
    );
  }

  async function runPreview() {
    if (!setup?.repository || !setup.vercelProject) return;
    const result = await post(
      "/api/deploy",
      {
        ...scope,
        repositoryId: setup.repository.id,
        vercelProjectId: setup.vercelProject.id,
        environment: "preview",
        gitRef: setup.repository.defaultBranch,
        idempotencyKey: `setup-preview:${project.id}:${Date.now()}`,
      },
      "preview",
    );
    if (!result) return;
    setDeployment({ id: result.deploymentId, status: "queued" });
    setMessage("Safe preview deployment queued. HD SEO is monitoring it now.");
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await wait(attempt === 0 ? 1000 : 3000);
      const response = await fetch(result.statusUrl, { cache: "no-store" });
      const status = await response.json();
      if (!response.ok) {
        setError(status.error?.message ?? "Preview deployment status could not be loaded.");
        return;
      }
      const next = status.deployment as { id: string; status: string; url?: string | null };
      setDeployment(next);
      if (["healthy", "failed", "cancelled", "rolled_back"].includes(next.status)) {
        setMessage(
          next.status === "healthy"
            ? "Preview deployment passed the production safety checks."
            : `Preview deployment finished with status: ${next.status.replaceAll("_", " ")}.`,
        );
        return;
      }
    }
    setMessage("The preview deployment is still running. Its status is available in Activity.");
  }

  const checks = setup?.checks;
  const completed = checks
    ? [
        checks.repositoryConnected,
        checks.vercelConnectionActive,
        checks.vercelProjectConnected,
        checks.manualWorkflowVerified,
        checks.automationEnabled,
      ].filter(Boolean).length
    : 0;

  function stepClass(done: boolean, available = true) {
    return done ? "complete" : available ? "current" : "blocked";
  }

  return (
    <div className="modal-backdrop deployment-setup-backdrop" onMouseDown={() => onClose(changed)}>
      <div className="modal live-dialog deployment-setup" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" disabled={busy !== null} onClick={() => onClose(changed)}>×</button>
        <div className="deployment-setup-heading">
          <small>GITHUB + VERCEL SETUP</small>
          <h2>Turn on safe repository deployments</h2>
          <p>{project.name} · {project.domain}</p>
        </div>

        <div className="deployment-progress" aria-label={`${completed} of 5 setup steps complete`}>
          <span style={{ width: `${(completed / 5) * 100}%` }} />
        </div>
        <div className="deployment-progress-label"><strong>{completed} of 5 complete</strong><span>No production change is published during setup.</span></div>

        {error && <div className="github-alert error" role="alert">{error}</div>}
        {message && <div className="github-alert success" role="status">✓ {message}</div>}
        {busy === "loading" && !setup ? <div className="deployment-loading">Checking GitHub, Vercel, and safety controls…</div> : setup && <div className="deployment-steps">
          <article className={stepClass(checks!.repositoryConnected)}>
            <span>{checks!.repositoryConnected ? "✓" : "1"}</span>
            <div><small>GITHUB REPOSITORY</small><strong>{setup.repository?.fullName ?? "Connect the client repository"}</strong><p>{checks!.repositoryConnected ? `Authorized through ${setup.installation?.accountLogin}.` : "Choose the repository HD SEO may update through pull requests."}</p></div>
            {!checks!.repositoryConnected && <a className="github-primary" href={`/api/github/install?agencyId=${encodeURIComponent(agencyId)}&clientId=${encodeURIComponent(project.clientId)}&projectId=${encodeURIComponent(project.id)}&returnUrl=${encodeURIComponent("/portal/agency?tab=Websites&github=connected")}`}>Connect GitHub</a>}
          </article>

          <article className={stepClass(checks!.vercelConnectionActive)}>
            <span>{checks!.vercelConnectionActive ? "✓" : "2"}</span>
            <div><small>VERCEL ACCOUNT</small><strong>{checks!.vercelConnectionActive ? "Agency Vercel access connected" : "Connect the agency Vercel account"}</strong><p>{checks!.vercelConnectionActive ? `Verified ${setup.vercelConnection?.lastVerifiedAt ? new Date(setup.vercelConnection.lastVerifiedAt).toLocaleString() : "now"}.` : "HD SEO uses the encrypted server credential; the token never enters this browser."}</p></div>
            {!checks!.vercelConnectionActive && <button className="github-primary" disabled={busy !== null} onClick={() => void connectAgencyVercel()}>{busy === "vercel-account" ? "Connecting…" : "Connect Vercel"}</button>}
          </article>

          <article className={stepClass(checks!.vercelProjectConnected, checks!.repositoryConnected && checks!.vercelConnectionActive)}>
            <span>{checks!.vercelProjectConnected ? "✓" : "3"}</span>
            <div><small>PROJECT MAPPING</small><strong>{setup.vercelProject?.name ?? "Link repository to a Vercel project"}</strong><p>{checks!.vercelProjectConnected ? `Production branch: ${setup.vercelProject?.productionBranch}.` : "HD SEO will reuse a matching project or create one from the connected repository."}</p>{!checks!.vercelProjectConnected && checks!.repositoryConnected && checks!.vercelConnectionActive && <div className="deployment-advanced"><button type="button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide advanced option" : "Already have a Vercel project?"}</button>{advanced && <label>Existing Vercel project name or ID<input value={existingProject} onChange={(event) => setExistingProject(event.target.value)} placeholder="Leave blank to find or create automatically" /></label>}</div>}</div>
            {!checks!.vercelProjectConnected && <button className="github-primary" disabled={busy !== null || !checks!.repositoryConnected || !checks!.vercelConnectionActive} onClick={() => void connectVercelProject()}>{busy === "vercel-project" ? "Connecting…" : "Connect project"}</button>}
          </article>

          <article className={stepClass(checks!.manualWorkflowVerified)}>
            <span>{checks!.manualWorkflowVerified ? "✓" : "4"}</span>
            <div><small>FIRST SAFE CHANGE</small><strong>{checks!.manualWorkflowVerified ? "Manual workflow verified" : "Verify one human-reviewed implementation"}</strong><p>{checks!.manualWorkflowVerified ? "The required safety baseline is complete." : "This proves approvals, implementation evidence, and validation work before repository writes are allowed."}</p></div>
            {!checks!.manualWorkflowVerified && <button className="github-primary secondary" onClick={() => { onClose(false); onOpenPackages(); }}>Open Packages</button>}
          </article>

          <article className={stepClass(checks!.automationEnabled, checks!.repositoryConnected && checks!.vercelProjectConnected && checks!.manualWorkflowVerified)}>
            <span>{checks!.automationEnabled ? "✓" : "5"}</span>
            <div><small>AUTOMATION ACTIVATION</small><strong>{checks!.automationEnabled ? "Human-approved automation enabled" : "Enable GitHub + Vercel automation"}</strong><p>{checks!.automationEnabled ? "HD SEO can prepare pull requests and guarded preview deployments." : "Repository actions remain approval-gated and auditable, with bounded retries and rollback protection."}</p>{!checks!.automationEnabled && setup.readiness.blockers.length > 0 && <ul>{setup.readiness.blockers.map((blocker) => <li key={blocker}>{blockerLabels[blocker] ?? blocker.replaceAll("_", " ").toLowerCase()}</li>)}</ul>}</div>
            {!checks!.automationEnabled && <button className="github-primary" disabled={busy !== null || !checks!.repositoryConnected || !checks!.vercelProjectConnected || !checks!.manualWorkflowVerified} onClick={() => void enableAutomation()}>{busy === "automation" ? "Enabling…" : "Enable automation"}</button>}
          </article>
        </div>}

        {setup?.checks.complete && <section className="deployment-ready">
          <div><small>READY FOR AUTOMATIC DEPLOYMENTS</small><strong>GitHub and Vercel are connected</strong><p>Test credentials, then run an isolated preview build before using the production workflow.</p></div>
          <div className="deployment-ready-actions"><button disabled={busy !== null} onClick={() => void testConnections()}>{busy === "test" ? "Testing…" : "Test connections"}</button><button className="github-primary" disabled={busy !== null} onClick={() => void runPreview()}>{busy === "preview" ? "Queueing…" : "Run safe preview"}</button></div>
          {deployment && <div className="deployment-result"><span>{deployment.status.replaceAll("_", " ")}</span>{deployment.url && <a href={`https://${deployment.url.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer">Open preview ↗</a>}</div>}
        </section>}

        <footer className="deployment-setup-footer"><span>Production deployments still require an approved HD SEO action.</span><button onClick={() => onClose(changed)}>{setup?.checks.complete ? "Done" : "Close"}</button></footer>
      </div>
    </div>
  );
}
