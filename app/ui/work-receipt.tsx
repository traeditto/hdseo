"use client";

import { FormEvent, useEffect, useState } from "react";

type TimelineItem = { key: string; label: string; complete: boolean };
type Receipt = {
  package: {
    id: string;
    title: string;
    description: string;
    status: string;
    stage: string;
    riskLevel: string;
    approvedAt: string | null;
    implementedAt: string | null;
    approvalBound: boolean;
    proposedState: unknown;
    acceptanceCriteria: unknown[];
    verificationChecklist: unknown[];
  };
  proposal: {
    keyword: string;
    actionType: string | null;
    score: number | null;
    confidence: number | null;
    searchVolume: number | null;
    cpc: number | null;
    difficulty: number | null;
    currentPosition: number | null;
    targetUrl: string | null;
    expectedValue: number | null;
    recommendations: unknown[];
    exactChange: unknown;
  };
  execution: {
    hasStarted: boolean;
    isPublished: boolean;
    isVerified: boolean;
    status: string;
    branch: string | null;
    pullRequestUrl: string | null;
    previewUrl: string | null;
    liveUrl: string | null;
    validation: unknown;
    verifiedAt: string | null;
    blocked: boolean;
    failureCode: string | null;
    failureMessage: string | null;
    pickupTarget: string | null;
    nextAction: string;
  };
  timeline: TimelineItem[];
  proof: Array<{
    id: string;
    type: string;
    title: string;
    description: string | null;
    occurredAt: string;
    url: string | null;
  }>;
  creative: {
    recommended: boolean;
    message: string;
    specStatus: string;
    draftStatus: string | null;
    draftTitle: string | null;
    creativeAngle: string | null;
    verifiedProofCount: number;
    verifiedPhotoCount: number;
    totalPhotoCount: number;
    proofReady: boolean;
    canUpload: boolean;
  };
  spend: {
    outcomeCapacitySource: string | null;
    outcomeStatus: string | null;
    outcomeCustomerAmount: number;
    externalMonthlyCeiling: number;
    externalSpentThisMonth: number;
    externalTransactions: Array<{
      id: string;
      category: string;
      provider: string;
      description: string;
      amount: number;
      currency: string;
      approvalStatus: string;
      occurredAt: string;
    }>;
    explanation: string;
  };
};

const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not yet";
const compactJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

export function WorkReceipt({
  projectId,
  packageId,
  onClose,
}: {
  projectId: string;
  packageId: string;
  onClose: () => void;
}) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setError("");
    const response = await fetch(
      `/api/work-receipts?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok) {
      setError(result.error?.message ?? "The work receipt could not be loaded.");
      return;
    }
    setReceipt(result.receipt);
  }

  // The receipt is a live operational view. Polling removes the need for a
  // business owner to understand queues, cron schedules, or browser refreshes.
  useEffect(() => {
    let active = true;
    const refresh = () =>
      fetch(
        `/api/work-receipts?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`,
        { cache: "no-store" },
      )
        .then(async (response) => ({ response, result: await response.json() }))
        .then(({ response, result }) => {
          if (!active) return;
          if (!response.ok) {
            setError(result.error?.message ?? "The work receipt could not be loaded.");
            return;
          }
          setError("");
          setReceipt(result.receipt);
        })
        .catch(() => {
          if (active) setError("The work receipt could not be loaded.");
        });
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [projectId, packageId]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  async function uploadProof(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("projectId", projectId);
    formData.set("attestRights", "yes");
    setUploading(true);
    setMessage("");
    try {
      const response = await fetch("/api/creatives/proof-upload", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error?.message ?? "The photo could not be uploaded.");
        return;
      }
      form.reset();
      setMessage("Photo added to this business’s verified Proof Vault.");
      await load();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="work-receipt-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="work-receipt"
        role="dialog"
        aria-modal="true"
        aria-label="SEO work receipt"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <small>ACCOUNTABLE SEO WORK RECEIPT</small>
            <h1>{receipt?.package.title ?? "Loading work receipt…"}</h1>
            {receipt && (
              <p>
                Current stage: <strong>{label(receipt.package.stage)}</strong>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close work receipt">
            ×
          </button>
        </header>

        {error && <div className="work-receipt-error">{error}</div>}
        {!receipt && !error && <div className="work-receipt-loading">Gathering the evidence trail…</div>}
        {receipt && (
          <div className="work-receipt-body">
            <aside className={receipt.execution.hasStarted ? "receipt-truth active" : "receipt-truth waiting"}>
              <strong>
                {receipt.execution.isVerified
                  ? "Completed and independently verified"
                  : receipt.execution.blocked
                    ? "Approved, but one requirement still needs attention"
                  : receipt.execution.hasStarted
                    ? "The approved work is now in progress"
                    : "Approved means authorized—not completed"}
              </strong>
              <p>{receipt.execution.nextAction}</p>
              <span>Approval recorded {date(receipt.package.approvedAt)}</span>
            </aside>
            {receipt.execution.pickupTarget && (
              <aside className="receipt-truth active">
                <strong>What happens next</strong>
                <p>{receipt.execution.pickupTarget} It will prepare a reviewable change, create a protected preview when the connection supports it, run QA, then follow the selected release approval policy.</p>
                <span>No outcome is finally charged until a customer-visible delivery is independently verified.</span>
              </aside>
            )}

            <section className="receipt-section receipt-timeline">
              <div className="receipt-section-head">
                <small>LIVE STATUS</small>
                <h2>What happened after approval</h2>
              </div>
              <div className="receipt-timeline-grid">
                {receipt.timeline.map((item, index) => (
                  <article className={item.complete ? "complete" : "pending"} key={item.key}>
                    <i>{item.complete ? "✓" : index + 1}</i>
                    <span>{item.label}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="receipt-section">
              <div className="receipt-section-head">
                <small>WHAT HD SEO FOUND</small>
                <h2>The keyword and exact proposed move</h2>
              </div>
              <div className="receipt-keyword">
                <div>
                  <strong>{receipt.proposal.keyword}</strong>
                  <span>
                    {receipt.proposal.actionType ? label(receipt.proposal.actionType) : "SEO improvement"}
                    {receipt.proposal.targetUrl ? ` · ${receipt.proposal.targetUrl}` : ""}
                  </span>
                </div>
                <b>{receipt.proposal.score ?? "—"}</b>
              </div>
              <div className="receipt-metrics">
                <span><b>{receipt.proposal.searchVolume?.toLocaleString() ?? "—"}</b>monthly searches</span>
                <span><b>{receipt.proposal.currentPosition ?? "—"}</b>current position</span>
                <span><b>{receipt.proposal.cpc == null ? "—" : money(receipt.proposal.cpc)}</b>paid-click value</span>
                <span><b>{receipt.proposal.confidence == null ? "—" : `${receipt.proposal.confidence}%`}</b>evidence confidence</span>
              </div>
              {receipt.proposal.expectedValue != null && (
                <p className="receipt-disclaimer">
                  Directional modeled opportunity: {money(receipt.proposal.expectedValue)}. This is an estimate based on recorded assumptions—not guaranteed revenue.
                </p>
              )}
              <details>
                <summary>See the exact page, content, code and validation plan</summary>
                <pre>{compactJson(receipt.proposal.exactChange)}</pre>
              </details>
            </section>

            <section className="receipt-section receipt-creative">
              <div className="receipt-section-head">
                <small>CREATIVE AGENT</small>
                <h2>{receipt.creative.recommended ? "A custom creative would help this keyword" : "Real proof can strengthen this work"}</h2>
              </div>
              <p>{receipt.creative.message}</p>
              <div className="receipt-creative-state">
                <span><b>{receipt.creative.verifiedPhotoCount}</b>verified photos</span>
                <span><b>{receipt.creative.verifiedProofCount}</b>verified proof items</span>
                <span><b>{label(receipt.creative.specStatus)}</b>creative status</span>
              </div>
              {receipt.creative.draftTitle && <p><strong>Draft:</strong> {receipt.creative.draftTitle}</p>}
              {receipt.creative.canUpload && (
                <form className="receipt-photo-upload" onSubmit={uploadProof}>
                  <label>
                    Add a real project photo
                    <input name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
                  </label>
                  <label>
                    What does this show?
                    <input name="title" minLength={3} maxLength={160} required placeholder="Roof repair completed in Jacksonville" />
                  </label>
                  <label>
                    Helpful details
                    <textarea name="summary" minLength={10} maxLength={5000} required placeholder="What was repaired, where, and what made the work useful to this customer?" />
                  </label>
                  <div>
                    <label>Service<input name="service" placeholder="Roof repair" /></label>
                    <label>Location<input name="location" placeholder="Jacksonville, FL" /></label>
                  </div>
                  <label className="receipt-attestation">
                    <input type="checkbox" required />
                    I own this photo or have permission to use it for this business.
                  </label>
                  <button disabled={uploading}>{uploading ? "Uploading…" : "Add photo to Proof Vault"}</button>
                  {message && <p>{message}</p>}
                </form>
              )}
            </section>

            <section className="receipt-section">
              <div className="receipt-section-head">
                <small>EXECUTION PROOF</small>
                <h2>Links, checks and independent evidence</h2>
              </div>
              <div className="receipt-proof-links">
                {receipt.execution.pullRequestUrl && <a href={receipt.execution.pullRequestUrl} target="_blank" rel="noreferrer">Open GitHub pull request ↗</a>}
                {receipt.execution.previewUrl && <a href={receipt.execution.previewUrl} target="_blank" rel="noreferrer">Open protected preview ↗</a>}
                {receipt.execution.liveUrl && <a href={receipt.execution.liveUrl} target="_blank" rel="noreferrer">Open verified live page ↗</a>}
              </div>
              {receipt.proof.length ? (
                <div className="receipt-proof-list">
                  {receipt.proof.map((event) => (
                    <article key={event.id}>
                      <i>✓</i>
                      <div><strong>{event.title}</strong><p>{event.description}</p><span>{date(event.occurredAt)}</span></div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="receipt-empty-proof">
                  No execution proof exists yet. HD SEO will add the branch, preview, QA and live verification here as each step succeeds.
                </p>
              )}
              {receipt.execution.validation != null && (
                <details><summary>See validation evidence</summary><pre>{compactJson(receipt.execution.validation)}</pre></details>
              )}
            </section>

            <section className="receipt-section receipt-spend">
              <div className="receipt-section-head">
                <small>COST RECEIPT</small>
                <h2>What the plan covers—and what was actually spent</h2>
              </div>
              <p>{receipt.spend.explanation}</p>
              <div className="receipt-metrics">
                <span><b>{receipt.spend.outcomeCapacitySource === "prepaid" ? "Add-on" : "Included"}</b>agent outcome</span>
                <span><b>{money(receipt.spend.outcomeCustomerAmount)}</b>additional outcome charge</span>
                <span><b>{money(receipt.spend.externalMonthlyCeiling)}</b>optional outside-spend ceiling</span>
                <span><b>{money(receipt.spend.externalSpentThisMonth)}</b>actual outside spend this month</span>
              </div>
              {receipt.spend.externalTransactions.length > 0 && (
                <div className="receipt-transactions">
                  {receipt.spend.externalTransactions.map((item) => (
                    <article key={item.id}>
                      <div><strong>{item.description}</strong><span>{item.provider} · {label(item.category)} · {label(item.approvalStatus)}</span></div>
                      <b>{money(item.amount)}</b>
                    </article>
                  ))}
                </div>
              )}
              <aside>
                A $100 ceiling is enough for initial data checks and small, itemized local expenses. It is not required for included agent work and is not silently spent. Larger third-party purchases require a separate plain-English approval.
              </aside>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
