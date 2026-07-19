"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { MarketingFooter, MarketingHeader } from "../marketing-shared";
import { trackMarketingEvent } from "../marketing-analytics";

type Report = { score: number; pagesAnalyzed: number; context: string | null; findings: Array<{ code: string; severity: string; title: string; detail: string; urls: string[] }>; nextStep: string; limitations: string[] };

export default function AuditExperience() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<{ website: string; report: Report } | null>(null);
  const started = useRef(false);
  function beginForm() { if (!started.current) { started.current = true; trackMarketingEvent("audit_form_start", { placement: "audit_page" }); } }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); trackMarketingEvent("audit_form_submit", { placement: "audit_page" });
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/public/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ website: form.get("website"), service: form.get("service") || undefined, serviceArea: form.get("serviceArea") || undefined }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The audit could not be completed.");
      setResult(payload);
      requestAnimationFrame(() => document.getElementById("audit-results")?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The audit could not be completed."); }
    finally { setBusy(false); }
  }
  return <main className="marketing-site audit-conversion"><a className="skip-link" href="#audit-main">Skip to audit form</a><MarketingHeader /><div id="audit-main">
    <section className="audit-conversion-hero"><div><span className="pilot-chip dark">FREE · NO CREDIT CARD</span><span className="m-eyebrow light">25-PAGE WEBSITE AUDIT</span><h1>Find the website issues most worth fixing first.</h1><p>HD SEO safely reads up to 25 public pages, checks common technical and internal-link problems, and turns the findings into a plain-language next step.</p><ul><li><span>✓</span> Up to 25 public pages checked</li><li><span>✓</span> Prioritized technical findings</li><li><span>✓</span> A clear recommended next step</li><li><span>✓</span> No account connection or credit card</li></ul><div className="audit-time"><b>Expected time</b><span>Most audits finish in 1–3 minutes. Large or slow websites may take longer.</span></div></div><form onSubmit={submit} onFocus={beginForm} noValidate><header><span>START YOUR FREE AUDIT</span><strong>Required fields are marked *</strong></header><label htmlFor="website">Website <b aria-hidden="true">*</b><input id="website" name="website" type="url" inputMode="url" autoComplete="url" placeholder="https://yourbusiness.com" required aria-required="true" /></label><label htmlFor="service">Most important service <em>Optional</em><input id="service" name="service" type="text" autoComplete="off" maxLength={160} placeholder="Roof repair" /></label><label htmlFor="serviceArea">Primary service area <em>Optional</em><input id="serviceArea" name="serviceArea" type="text" autoComplete="address-level2" maxLength={160} placeholder="Jacksonville, FL" /></label><button disabled={busy}>{busy ? "Checking your website…" : "Get My Free 25-Page SEO Audit →"}</button><small>By submitting, you ask HD SEO to read public pages from the website you provide. We do not request login credentials, publish changes, or sell the submitted website details.</small>{error && <p className="audit-error" role="alert">{error}</p>}</form></section>

    <section className="audit-trust"><article><span className="m-eyebrow">WHAT WE USE</span><h2>Public website data only.</h2><p>The audit follows links available on the submitted website and evaluates the pages it can safely access. It does not log into your CMS or change the site.</p></article><article><span className="m-eyebrow">WHAT WE DO NOT CLAIM</span><h2>No ranking promises.</h2><p>The audit reports observable issues and limitations. It does not guarantee rankings, leads, or revenue.</p></article><article><span className="m-eyebrow">PILOT TRUST NOTE</span><h2>Proof is still being verified.</h2><p>Customer testimonials and performance claims will appear only after the customer, measurement window, and source data are approved.</p></article></section>

    <section className="sample-audit"><div><span className="m-eyebrow">ILLUSTRATIVE SAMPLE · NOT A CUSTOMER RESULT</span><h2>See the kind of answer you will receive.</h2><p>The actual findings depend on what HD SEO can verify on your public website.</p></div><div className="sample-report"><header><span>SAMPLE AUDIT PREVIEW</span><b>25-page limit</b></header><article><i>HIGH</i><div><strong>Important service page is hard to reach</strong><p>Key internal links may not guide visitors and search engines to the page efficiently.</p></div></article><article><i>MEDIUM</i><div><strong>Page descriptions need attention</strong><p>Several public pages may not clearly explain their service and local intent.</p></div></article><footer><span>Recommended first step</span><strong>Fix navigation paths before creating more content.</strong></footer></div></section>

    {result && <section className="audit-results-new" id="audit-results" tabIndex={-1}><div className="audit-result-score"><span>{result.report.score}</span><div><small>TECHNICAL READINESS</small><h2>{result.report.pagesAnalyzed} pages analyzed</h2><p>{result.report.context ? `Business context: ${result.report.context}` : "Add service and market details next time for more local context."}</p></div></div><div className="audit-result-findings">{result.report.findings.length ? result.report.findings.map(item => <article key={item.code}><b data-severity={item.severity}>{item.severity}</b><div><h3>{item.title}</h3><p>{item.detail}</p><small>{item.urls.length} affected page{item.urls.length === 1 ? "" : "s"}</small></div></article>) : <article><div><h3>No basic blockers found</h3><p>{result.report.nextStep}</p></div></article>}</div><div className="audit-result-next"><div><span className="m-eyebrow">YOUR NEXT STEP</span><h2>Turn the audit into an approval-ready plan.</h2><p>{result.report.nextStep}</p></div><Link href="/book-demo" data-analytics-event="booking_cta_click" data-analytics-placement="audit_result">Discuss My Audit →</Link></div><ul>{result.report.limitations.map(item => <li key={item}>{item}</li>)}</ul></section>}
  </div><MarketingFooter /></main>;
}
