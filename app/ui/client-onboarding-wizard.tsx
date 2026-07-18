"use client";

import { FormEvent, useMemo, useState } from "react";

type Analysis = {
  siteUrl: string;
  canonicalDomain: string;
  platform: string;
  platformLabel: string;
  confidence: string;
  reachable: boolean;
  pageTitle: string | null;
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
type Website = {
  projectId: string;
  connectionStatus: string | null;
  connectionMode: string | null;
  cmsType: string;
  googleSearchConsole: {
    status: string;
    selectedProperty: string | null;
  } | null;
};
type Data = { onboardings: Onboarding[]; websites: Website[] };
type Step =
  | "business"
  | "review"
  | "connections"
  | "automation"
  | "launch"
  | "complete";

const automationOptions = [
  {
    id: "recommend",
    title: "Recommend changes",
    badge: "Most control",
    description:
      "HD SEO prepares the work and waits for approval before anything is changed.",
  },
  {
    id: "safe",
    title: "Fix safe issues automatically",
    badge: "Recommended",
    description:
      "Safe technical and content improvements run automatically. Important changes still need approval.",
  },
  {
    id: "autopilot",
    title: "Full autopilot",
    badge: "Hands off",
    description:
      "HD SEO runs approved categories automatically while protecting DNS, pricing, legal claims, and major design changes.",
  },
] as const;

function list(value: string) {
  return [
    ...new Set(
      value
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function ClientOnboardingWizard({
  data,
  initialProjectId,
  initialStep,
  onData,
  onOpenWebsites,
}: {
  data: Data;
  initialProjectId?: string;
  initialStep?: string;
  onData: (data: Data, message: string) => void;
  onOpenWebsites: () => void;
}) {
  const existing = useMemo(
    () => data.onboardings.find((item) => item.projectId === initialProjectId),
    [data.onboardings, initialProjectId],
  );
  const [step, setStep] = useState<Step>(() =>
    existing?.status === "launched"
      ? "complete"
      : initialStep === "connections" && existing
        ? "connections"
        : existing
          ? "automation"
          : "business",
  );
  const [projectId, setProjectId] = useState(
    initialProjectId ?? existing?.projectId ?? "",
  );
  const [analysis, setAnalysis] = useState<Analysis | null>(
    existing
      ? {
          siteUrl: "",
          canonicalDomain: "",
          platform: existing.detectedPlatform,
          platformLabel: existing.platformLabel,
          confidence: existing.platformConfidence,
          reachable: existing.websiteReachable,
          pageTitle: null,
        }
      : null,
  );
  const [draft, setDraft] = useState({
    name: "",
    domain: "",
    contactEmail: "",
    phone: "",
    services: "",
    serviceAreas: "",
    marketScope: "service_area" as "service_area" | "nationwide",
    monthlyBudget: "1500",
    targetMarket: "",
  });
  const [automationLevel, setAutomationLevel] = useState<
    Onboarding["automationLevel"]
  >(existing?.automationLevel ?? "safe");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const onboarding =
    data.onboardings.find((item) => item.projectId === projectId) ?? existing;
  const website = data.websites.find((item) => item.projectId === projectId);
  const googleConnected = website?.googleSearchConsole?.status === "active";
  const websiteReady =
    website?.connectionStatus === "active" ||
    website?.connectionMode === "monitor_only";
  const steps = ["Business", "Website", "Connect", "Automation", "Launch"];
  const stepIndex =
    step === "business"
      ? 0
      : step === "review"
        ? 1
        : step === "connections"
          ? 2
          : step === "automation"
            ? 3
            : 4;

  async function request(body: Record<string, unknown>) {
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
          result.error?.message ?? "HD SEO could not complete that step.",
        );
        return null;
      }
      if (result.data) onData(result.data, result.message ?? "Saved");
      return result;
    } catch {
      setMessage(
        "HD SEO could not reach the server. Check the connection and try again.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await request({
      action: "analyze_website",
      domain: draft.domain,
    });
    if (result?.analysis) {
      setAnalysis(result.analysis);
      setStep("review");
    }
  }

  async function createClient() {
    const services = list(draft.services),
      serviceAreas = list(draft.serviceAreas);
    if (!services.length) {
      setMessage("Add at least one service.");
      return;
    }
    if (draft.marketScope === "service_area" && !serviceAreas.length) {
      setMessage(
        "Add at least one city or service area, or choose Nationwide.",
      );
      return;
    }
    const result = await request({
      action: "create_client_onboarding",
      name: draft.name,
      domain: draft.domain,
      contactEmail: draft.contactEmail,
      phone: draft.phone,
      services,
      serviceAreas,
      marketScope: draft.marketScope,
      monthlyBudget: Number(draft.monthlyBudget),
      targetMarket:
        draft.marketScope === "nationwide"
          ? "United States"
          : draft.targetMarket.trim() || serviceAreas[0],
    });
    if (result?.onboarding?.projectId) {
      setProjectId(result.onboarding.projectId);
      setAnalysis(result.onboarding.analysis);
      setStep("connections");
    }
  }

  async function saveAutomation() {
    const result = await request({
      action: "set_onboarding_automation",
      projectId,
      automationLevel,
    });
    if (result) setStep("launch");
  }

  async function launch() {
    const result = await request({
      action: "launch_client_onboarding",
      projectId,
    });
    if (result) setStep("complete");
  }

  function update(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  if (step === "complete")
    return (
      <section className="onboarding-card onboarding-complete">
        <span className="onboarding-success">✓</span>
        <small>HD SEO IS WORKING</small>
        <h1>SEO automation is live</h1>
        <p>
          HD SEO is crawling the website, collecting Google evidence,
          discovering valuable keywords, and building the first prioritized
          plan.
        </p>
        <div className="launch-status">
          <span>
            <b>Website crawl</b>
            <em>Queued</em>
          </span>
          <span>
            <b>Keyword discovery</b>
            <em>Running</em>
          </span>
          <span>
            <b>First 30-day plan</b>
            <em>Preparing</em>
          </span>
        </div>
        <button
          className="onboarding-primary"
          onClick={() => window.location.assign("/portal/agency?tab=Overview")}
        >
          Go to my SEO dashboard →
        </button>
      </section>
    );

  return (
    <section className="onboarding-card">
      <header className="onboarding-header">
        <div>
          <small>NEW CLIENT SETUP</small>
          <h1>Launch SEO in about five minutes</h1>
          <p>No keyword list, API keys, or technical setup required.</p>
        </div>
        <strong>{stepIndex + 1} of 5</strong>
      </header>
      <div className="onboarding-progress">
        {steps.map((item, index) => (
          <span key={item} className={index <= stepIndex ? "active" : ""}>
            <i>{index < stepIndex ? "✓" : index + 1}</i>
            <b>{item}</b>
          </span>
        ))}
      </div>
      {step === "business" && (
        <form className="onboarding-form" onSubmit={analyze}>
          <div className="onboarding-copy">
            <small>THE BASICS</small>
            <h2>Tell us about the business</h2>
            <p>
              HD SEO uses the website and these details to find the best
              opportunities automatically.
            </p>
          </div>
          <div className="onboarding-grid">
            <label>
              Website address
              <input
                value={draft.domain}
                onChange={(event) => update("domain", event.target.value)}
                placeholder="yourbusiness.com"
                inputMode="url"
                required
              />
            </label>
            <label>
              Business name
              <input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Kingdom Roofing"
                required
              />
            </label>
          </div>
          <label>
            What services do you sell?
            <textarea
              value={draft.services}
              onChange={(event) => update("services", event.target.value)}
              placeholder="Roof replacement, roof repair, storm damage"
              required
            />
            <small>
              Separate services with commas. HD SEO turns these into search
              opportunities—you do not need to enter keywords.
            </small>
          </label>
          <fieldset className="market-scope-options">
            <legend>Where can customers buy from this business?</legend>
            <label>
              <input
                type="radio"
                checked={draft.marketScope === "service_area"}
                onChange={() => update("marketScope", "service_area")}
              />
              <span>
                <b>Specific service areas</b>
                <small>
                  Best for contractors, local professionals, stores, and
                  location-tethered services.
                </small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                checked={draft.marketScope === "nationwide"}
                onChange={() => update("marketScope", "nationwide")}
              />
              <span>
                <b>Nationwide</b>
                <small>
                  Best for ecommerce, software, remote services, and brands
                  serving the entire country.
                </small>
              </span>
            </label>
          </fieldset>
          {draft.marketScope === "service_area" && (
            <label>
              Choose cities or service areas
              <textarea
                value={draft.serviceAreas}
                onChange={(event) => update("serviceAreas", event.target.value)}
                placeholder="Jacksonville, St. Augustine, Orange Park"
                required
              />
              <small>
                Explicit searches outside these areas will be excluded.
              </small>
            </label>
          )}
          <label>
            Monthly SEO budget
            <input
              type="number"
              min="100"
              step="100"
              value={draft.monthlyBudget}
              onChange={(event) => update("monthlyBudget", event.target.value)}
              required
            />
            <small>
              {draft.marketScope === "nationwide"
                ? "Keyword demand will be evaluated across the United States."
                : "Keyword demand and rankings will be measured inside the selected service areas."}
            </small>
          </label>
          <div className="onboarding-grid">
            <label>
              Best phone number <em>optional</em>
              <input
                value={draft.phone}
                onChange={(event) => update("phone", event.target.value)}
                inputMode="tel"
              />
            </label>
            <label>
              Client email <em>optional</em>
              <input
                value={draft.contactEmail}
                onChange={(event) => update("contactEmail", event.target.value)}
                type="email"
              />
            </label>
          </div>
          {message && <div className="onboarding-message">{message}</div>}
          <button className="onboarding-primary" disabled={busy}>
            {busy ? "Checking the website…" : "Continue — check my website →"}
          </button>
        </form>
      )}
      {step === "review" && analysis && (
        <div className="onboarding-form">
          <div className="onboarding-copy">
            <small>WE FOUND THE WEBSITE</small>
            <h2>{analysis.platformLabel} detected</h2>
            <p>{analysis.pageTitle || analysis.canonicalDomain}</p>
          </div>
          <div className="detected-site">
            <span className={analysis.reachable ? "ready" : ""}>⌁</span>
            <div>
              <strong>{analysis.canonicalDomain}</strong>
              <p>
                {analysis.reachable
                  ? "The public website is reachable and ready for no-login monitoring."
                  : "The domain was found, but the website needs attention."}
              </p>
            </div>
            <em>{analysis.confidence} confidence</em>
          </div>
          <div className="plain-language-note">
            <strong>You do not need GitHub or a developer.</strong>
            <p>
              HD SEO can start crawling and monitoring this site now. Editing
              access can be connected later when you are ready to publish
              changes automatically.
            </p>
          </div>
          {message && <div className="onboarding-message">{message}</div>}
          <div className="onboarding-actions">
            <button onClick={() => setStep("business")}>← Edit details</button>
            <button
              className="onboarding-primary"
              disabled={busy}
              onClick={() => void createClient()}
            >
              {busy ? "Creating the workspace…" : "Looks right — continue →"}
            </button>
          </div>
        </div>
      )}
      {step === "connections" && (
        <div className="onboarding-form">
          <div className="onboarding-copy">
            <small>CONNECT THE EVIDENCE</small>
            <h2>Give HD SEO the clearest picture</h2>
            <p>
              The website is already available for monitoring. Connecting Google
              adds real search performance data.
            </p>
          </div>
          <div className="connection-checklist">
            <article className="done">
              <i>✓</i>
              <div>
                <strong>Website monitoring</strong>
                <p>
                  {analysis?.platformLabel ||
                    onboarding?.platformLabel ||
                    "Website"}{" "}
                  detected. No login required.
                </p>
              </div>
              <em>{websiteReady ? "READY" : "CHECKING"}</em>
            </article>
            <article className={googleConnected ? "done" : ""}>
              <i>{googleConnected ? "✓" : "G"}</i>
              <div>
                <strong>Google Search Console</strong>
                <p>
                  {googleConnected
                    ? `Connected${website?.googleSearchConsole?.selectedProperty ? ` to ${website.googleSearchConsole.selectedProperty}` : ""}.`
                    : "See searches, rankings, clicks, and pages directly from Google."}
                </p>
              </div>
              {googleConnected ? (
                <em>CONNECTED</em>
              ) : (
                <a
                  href={`/api/google/connect?projectId=${encodeURIComponent(projectId)}&returnUrl=${encodeURIComponent(`/portal/agency?tab=Onboarding&onboarding=${projectId}&step=connections&gsc=connected`)}`}
                >
                  Connect Google
                </a>
              )}
            </article>
          </div>
          <button className="text-button" onClick={onOpenWebsites}>
            Want automatic publishing? Connect editing access later under
            Website.
          </button>
          {message && <div className="onboarding-message">{message}</div>}
          <div className="onboarding-actions">
            <span />
            <button
              className="onboarding-primary"
              onClick={() => setStep("automation")}
            >
              {googleConnected ? "Continue →" : "Continue without Google →"}
            </button>
          </div>
        </div>
      )}
      {step === "automation" && (
        <div className="onboarding-form">
          <div className="onboarding-copy">
            <small>CHOOSE YOUR COMFORT LEVEL</small>
            <h2>How hands-off should HD SEO be?</h2>
            <p>
              You can change this later. DNS, legal claims, pricing, and major
              design changes always stay protected.
            </p>
          </div>
          <div className="automation-options">
            {automationOptions.map((option) => (
              <button
                key={option.id}
                className={automationLevel === option.id ? "selected" : ""}
                onClick={() => setAutomationLevel(option.id)}
              >
                <i>{automationLevel === option.id ? "✓" : ""}</i>
                <div>
                  <span>
                    <strong>{option.title}</strong>
                    <em>{option.badge}</em>
                  </span>
                  <p>{option.description}</p>
                </div>
              </button>
            ))}
          </div>
          {message && <div className="onboarding-message">{message}</div>}
          <div className="onboarding-actions">
            <button onClick={() => setStep("connections")}>← Back</button>
            <button
              className="onboarding-primary"
              disabled={busy}
              onClick={() => void saveAutomation()}
            >
              {busy ? "Saving…" : "Continue →"}
            </button>
          </div>
        </div>
      )}
      {step === "launch" && (
        <div className="onboarding-form">
          <div className="onboarding-copy">
            <small>READY TO START</small>
            <h2>HD SEO will take it from here</h2>
            <p>
              Review the simple plan, then start the first crawl, keyword
              discovery, and 30-day strategy.
            </p>
          </div>
          <div className="launch-summary">
            <span>
              <small>BUSINESS</small>
              <strong>
                {draft.name || analysis?.canonicalDomain || "New client"}
              </strong>
            </span>
            <span>
              <small>SERVICES</small>
              <strong>
                {onboarding?.services.length ?? list(draft.services).length}{" "}
                added
              </strong>
            </span>
            <span>
              <small>PRIMARY SERVICE AREA</small>
              <strong>
                {onboarding?.targetMarket ||
                  draft.targetMarket ||
                  list(draft.serviceAreas)[0] ||
                  "Not set"}
              </strong>
            </span>
            <span>
              <small>MONTHLY BUDGET</small>
              <strong>
                $
                {(
                  onboarding?.monthlyBudget ?? Number(draft.monthlyBudget)
                ).toLocaleString()}
              </strong>
            </span>
            <span>
              <small>AUTOMATION</small>
              <strong>
                {
                  automationOptions.find((item) => item.id === automationLevel)
                    ?.title
                }
              </strong>
            </span>
            <span>
              <small>GOOGLE</small>
              <strong>
                {googleConnected ? "Connected" : "Can connect later"}
              </strong>
            </span>
          </div>
          <div className="plain-language-note">
            <strong>No keywords required.</strong>
            <p>
              Starting authorizes a capped domain-data discovery run. HD SEO
              will find and prioritize the keywords based on customer value,
              difficulty, rankings, and your selected budget.
            </p>
          </div>
          {message && <div className="onboarding-message">{message}</div>}
          <div className="onboarding-actions">
            <button onClick={() => setStep("automation")}>← Back</button>
            <button
              className="onboarding-primary launch"
              disabled={busy}
              onClick={() => void launch()}
            >
              {busy
                ? "Starting website crawl and keyword discovery…"
                : "Start My SEO →"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
