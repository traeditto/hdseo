"use client";

import Link from "next/link";
import { useState } from "react";
import { Arrow, MarketingFooter, MarketingHeader } from "../marketing-shared";
import { agentServicePlans, formatUsd, pricingAddOns, pricingFaq, pricingPlans, type BillingCadence, type PricingAudience, type PricingMode } from "../pricing-catalog";

function emitPricingEvent(event: string, context: Record<string, string>) {
  window.dispatchEvent(new CustomEvent("hdseo:marketing", { detail: { event, context, occurredAt: new Date().toISOString() } }));
}

function SegmentedControl({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return <div className="pricing-control"><span>{label}</span><div role="group" aria-label={label}>{options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></div>;
}

function WorkModeSelector({ value, onChange }: { value: PricingMode; onChange: (value: PricingMode) => void }) {
  return <section className="work-mode-selector" aria-labelledby="work-mode-title"><span className="m-eyebrow light">CHOOSE YOUR OPERATING MODEL</span><h1 id="work-mode-title">How do you want to work?</h1><div role="group" aria-label="How do you want to work?">
    <button type="button" aria-pressed={value === "guide"} onClick={() => onChange("guide")}><span>01</span><strong>GUIDE ME</strong><p>HD SEO finds the opportunities and gives me the tools to manage approved work.</p><i aria-hidden="true">{value === "guide" ? "Selected ✓" : "Select →"}</i></button>
    <button type="button" aria-pressed={value === "agent-service"} onClick={() => onChange("agent-service")}><span>02</span><strong>RUN IT FOR ME</strong><p>The HD SEO agent team researches, plans, implements, validates, and monitors approved SEO work for me.</p><i aria-hidden="true">{value === "agent-service" ? "Selected ✓" : "Select →"}</i></button>
  </div></section>;
}

function PricingFaq({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = `pricing-${question.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <article className="pricing-faq-item"><h3><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><span>{question}</span><i aria-hidden="true">{open ? "−" : "+"}</i></button></h3>{open && <p id={id}>{answer}</p>}</article>;
}

export default function PricingExperience() {
  const [mode, setMode] = useState<PricingMode>("guide");
  const [audience, setAudience] = useState<PricingAudience>("business");
  const [billing, setBilling] = useState<BillingCadence>("monthly");
  const [revenue, setRevenue] = useState(2500);
  const [margin, setMargin] = useState(45);
  const [closeRate, setCloseRate] = useState(30);
  const [selectedPlan, setSelectedPlan] = useState("growth");

  const platformPlans = pricingPlans.filter(plan => plan.audience === audience);
  const servicePlans = agentServicePlans.filter(plan => plan.audience === audience);
  const calculatorPlans = mode === "guide" ? platformPlans : servicePlans;
  const activePlan = calculatorPlans.find(plan => plan.slug === selectedPlan) ?? calculatorPlans[0];
  const activeAnnual = "annual" in activePlan ? activePlan.annual : undefined;
  const planCost = billing === "annual" && activeAnnual ? activeAnnual / 12 : activePlan.monthly;
  const grossProfit = Math.max(0, revenue) * Math.min(100, Math.max(0, margin)) / 100;
  const salesToCover = grossProfit > 0 ? planCost / grossProfit : 0;
  const leadsToCover = closeRate > 0 ? salesToCover / (Math.min(100, closeRate) / 100) : 0;
  const stickyPlatform = audience === "business" ? pricingPlans.find(plan => plan.slug === "growth")! : pricingPlans.find(plan => plan.slug === "agency-growth")!;
  const stickyService = servicePlans[0];
  const stickyPlan = mode === "guide" ? stickyPlatform : stickyService;

  const changeMode = (next: PricingMode) => {
    setMode(next);
    setSelectedPlan(next === "guide" ? (audience === "business" ? "growth" : "agency-growth") : (audience === "business" ? "autopilot" : "white-label-core"));
    emitPricingEvent("pricing_work_mode_toggle", { mode: next });
  };
  const changeAudience = (next: string) => {
    const typed = next as PricingAudience;
    setAudience(typed);
    setSelectedPlan(mode === "guide" ? (typed === "business" ? "growth" : "agency-growth") : (typed === "business" ? "autopilot" : "white-label-core"));
    emitPricingEvent("pricing_audience_toggle", { audience: typed });
  };
  const changeBilling = (next: string) => {
    const typed = next as BillingCadence;
    setBilling(typed);
    emitPricingEvent("pricing_billing_toggle", { billing: typed });
  };

  return <main className="marketing-site pricing-site"><a className="skip-link" href="#pricing-main">Skip to pricing</a><MarketingHeader /><div id="pricing-main">
    <section className="pricing-hero"><WorkModeSelector value={mode} onChange={changeMode} /><p className="mode-summary">{mode === "guide" ? "Choose the platform capacity that fits your team, then manage the approval workflow yourself." : audience === "business" ? "Meet HD SEO Autopilot: your autonomous SEO department, operating within your rules." : "Add a White-Label Agent Team that delivers approved client work without adding payroll."}</p><div className="pricing-controls"><SegmentedControl label="Choose your audience" value={audience} onChange={changeAudience} options={[{ value: "business", label: "Business" }, { value: "agency", label: "Agency" }]} /><SegmentedControl label="Billing frequency" value={billing} onChange={changeBilling} options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annual — 2 months free" }]} /></div><div className="pricing-hero-links"><Link href="/audit" data-analytics-event="primary_audit_cta_click" data-analytics-placement="pricing_hero">Start with a free audit</Link><Link href="/login/client">Existing business sign in</Link><Link href="/login/agency">Agency sign in</Link></div></section>

    {mode === "guide" ? <section className="pricing-card-section" aria-live="polite"><header><span className="m-eyebrow">PLATFORM MODE · {audience === "business" ? "BUSINESS PLANS" : "AGENCY PLANS"}</span><h2>{audience === "business" ? "From foundational fixes to multi-location growth." : "Pay for active client websites—not seats."}</h2><p>{audience === "business" ? "All plans combine research, approval-controlled implementation, validation, and outcome reporting." : "Add unlimited team members and read-only client viewers without per-seat charges."}</p></header><div className="pricing-grid">{platformPlans.map(plan => <article id={plan.slug} key={plan.slug} className={plan.label ? "recommended" : ""} tabIndex={0} aria-label={`${plan.name} plan, ${formatUsd(billing === "monthly" ? plan.monthly : plan.annual)}`}>
      {plan.label && <strong className="pricing-badge">{plan.label}</strong>}<span className="plan-audience">{plan.audience === "agency" ? "AGENCY" : "BUSINESS"}</span><h2>{plan.name}</h2><div className="plan-price"><strong>{formatUsd(billing === "monthly" ? plan.monthly : plan.annual)}</strong><span>{billing === "monthly" ? "/month" : "/year"}</span></div>{billing === "annual" && <small className="annual-note">Equivalent to {formatUsd(plan.annual / 12)}/month · 2 months free</small>}<p>{plan.description}</p><Link href={plan.href} data-analytics-event={plan.audience === "agency" ? "agency_plan_selection" : "business_plan_selection"} data-analytics-placement={plan.slug}>{plan.cta}<Arrow /></Link>{plan.supportingText && <small className="plan-support">{plan.supportingText}</small>}<ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
    </article>)}</div></section> : <section className="pricing-card-section agent-service-section" aria-live="polite"><header><span className="m-eyebrow">AGENT SERVICE MODE</span><h2>{audience === "business" ? "HD SEO Autopilot" : "White-Label Agent Team"}</h2><p>{audience === "business" ? "Your autonomous SEO department—with human oversight for complex or high-risk decisions." : "Add an autonomous, white-label SEO delivery team without adding payroll."}</p></header><div className={`pricing-grid agent-service-grid ${audience}`}>{servicePlans.map(plan => {
      const annualPrice = plan.annual;
      const showAnnual = billing === "annual" && annualPrice;
      return <article id={plan.slug} key={plan.slug} className="recommended" tabIndex={0} aria-label={`${plan.name}, ${formatUsd(showAnnual ? annualPrice : plan.monthly)}`}><strong className="pricing-badge">{plan.label}</strong><span className="plan-audience">{audience === "business" ? "HD SEO AUTOPILOT" : "WHITE-LABEL AGENT TEAM"}</span><h2>{plan.name}</h2><div className="plan-price"><strong>{formatUsd(showAnnual ? annualPrice : plan.monthly)}</strong><span>{showAnnual ? "/year" : audience === "business" ? "/month" : ""}</span></div><small className="annual-note">{showAnnual ? "Two months free" : plan.priceQualifier}</small>{plan.foundingOffer && <strong className="founding-offer">{audience === "business" ? "Founding pilot: " : ""}{plan.foundingOffer}</strong>}<p>{plan.description}</p><Link href={plan.href} data-analytics-event={audience === "agency" ? "agency_plan_selection" : "business_plan_selection"} data-analytics-placement={plan.slug}>{plan.cta}<Arrow /></Link><ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul></article>;
    })}</div>{audience === "agency" && billing === "annual" && <p className="agent-annual-note">White-Label Agent Team prices are shown monthly. Annual service terms are confirmed during the agency review.</p>}</section>}

    <section className="service-mode-comparison"><header><span className="m-eyebrow">PLATFORM OR AGENT SERVICE</span><h2>Choose how much of the workflow you want to operate.</h2></header><div><article className={mode === "guide" ? "active" : ""}><span>PLATFORM MODE</span><h3>You operate HD SEO</h3><ul><li>Lower monthly price</li><li>Recommendations and automation tools</li><li>Customer manages the workflow</li></ul></article><article className={mode === "agent-service" ? "active" : ""}><span>AGENT SERVICE MODE</span><h3>HD SEO agents operate the workflow</h3><ul><li>Research, strategy, implementation, QA, and monitoring included</li><li>Customer primarily reviews and approves</li><li>Monthly execution capacity included</li><li>Human escalation available</li></ul></article></div><p>Agent service does not mean unrestricted automation. Every agent operates within client permissions, approved service areas, spending limits, risk classifications, execution limits, validation rules, and approval requirements.</p></section>

    <section className="budget-band safeguards-band"><div><span className="m-eyebrow light">EXTERNAL SPENDING & SAFEGUARDS</span><h2>Agent work stays inside your rules.</h2><p>Subscription pricing covers the HD SEO platform and included agent work. Citations, sponsorships, outreach expenses, advertising, specialist services, and other third-party costs are separate and never purchased without approval.</p></div><div><ul><li>Nothing meaningful publishes without the configured approval.</li><li>DNS, pricing, legal, destructive, and high-risk work always requires human approval.</li><li>Every action is recorded.</li><li>Supported changes receive validation and rollback protection.</li><li>Rankings, leads, and revenue are not guaranteed.</li><li>Large development projects are scoped separately.</li></ul></div></section>

    {mode === "guide" && <section className="addon-section"><header><span className="m-eyebrow">OPTIONAL ADD-ONS</span><h2>Add capacity without changing the operating model.</h2></header><div>{pricingAddOns.map(([name, price]) => <article key={name}><span>{name}</span><strong>{price}</strong></article>)}</div></section>}

    <section className="enterprise-band"><div><span className="m-eyebrow light">ENTERPRISE</span><h2>Custom — starting at $2,500/month</h2><p>For multi-location and multi-brand organizations that need custom limits, infrastructure, governance, and support.</p></div><ul><li>Custom client and website limits</li><li>SSO and role-based access controls</li><li>Audit exports and custom retention policies</li><li>Dedicated infrastructure options</li><li>Provider rate-limit management</li><li>Advanced security reviews and custom SLAs</li><li>Dedicated onboarding and support</li></ul><Link href="/enterprise" data-analytics-event="enterprise_cta_click" data-analytics-placement="pricing_enterprise">Book an Enterprise Review <Arrow /></Link></section>

    <section className="comparison-section"><header><span className="m-eyebrow">VALUE COMPARISON</span><h2>Compare who turns the recommendation into finished work.</h2></header><div className="comparison-table" role="table" aria-label="SEO solution value comparison"><div role="row" className="comparison-head"><span role="columnheader">Option</span><span role="columnheader">Typical monthly cost</span><span role="columnheader">What it primarily provides</span><span role="columnheader">Who completes the work</span></div><div role="row"><strong role="cell">DIY SEO tools</strong><span role="cell">Approx. $29–$250</span><span role="cell">Data, reports, and recommendations</span><span role="cell">Usually the customer</span></div><div role="row"><strong role="cell">Traditional SEO agency</strong><span role="cell">Approx. $799–$1,299+ per location</span><span role="cell">Human-managed service; scope varies</span><span role="cell">The provider</span></div><div role="row" className="comparison-hd"><strong role="cell">HD SEO</strong><span role="cell">Starts at $199</span><span role="cell">Discovery, preparation, validation, measurement, and controls</span><span role="cell">You choose platform mode or an approval-controlled agent service</span></div></div><p className="market-note">Market ranges are illustrative and may change. Compare scope, implementation, limits, and contract terms—not price alone.</p></section>

    <section className="roi-section"><div><span className="m-eyebrow light">BREAK-EVEN PLANNER</span><h2>How much new business would cover the subscription?</h2><p>Use your own economics to understand the break-even point. This planning math is not a forecast.</p></div><form onSubmit={event => event.preventDefault()}><label>Average customer or job revenue<span>$<input type="number" min="0" step="100" value={revenue} onChange={event => setRevenue(Number(event.target.value))} /></span></label><label>Gross-profit margin<span><input type="number" min="0" max="100" step="1" value={margin} onChange={event => setMargin(Number(event.target.value))} />%</span></label><label>Lead-to-sale close rate<span><input type="number" min="1" max="100" step="1" value={closeRate} onChange={event => setCloseRate(Number(event.target.value))} />%</span></label><label>Selected HD SEO plan<select value={activePlan.slug} onChange={event => setSelectedPlan(event.target.value)}>{calculatorPlans.map(plan => { const annualPrice = "annual" in plan ? plan.annual : undefined; const display = billing === "annual" && annualPrice ? annualPrice : plan.monthly; return <option key={plan.slug} value={plan.slug}>{plan.name} — {formatUsd(display)}{billing === "annual" && annualPrice ? "/year" : "/month"}</option>; })}</select></label></form><div className="roi-results"><article><span>Estimated gross profit per new sale</span><strong>{formatUsd(grossProfit)}</strong></article><article><span>Approximate additional sales needed to cover one month</span><strong>{salesToCover > 0 ? salesToCover.toFixed(2) : "—"}</strong></article><article><span>Approximate qualified leads at your close rate</span><strong>{leadsToCover > 0 ? leadsToCover.toFixed(1) : "—"}</strong></article></div><small>Planning estimate only. This calculator does not predict or guarantee rankings, leads, sales, revenue, profit, or return.</small></section>

    <section className="pricing-faq"><header><span className="m-eyebrow">PRICING FAQ</span><h2>Know what you pay for and what stays under approval.</h2><p>Existing customers can <Link href="/login/client">sign in as a business</Link> or <Link href="/login/agency">sign in as an agency</Link>.</p></header><div>{pricingFaq.map(([question, answer]) => <PricingFaq key={question} question={question} answer={answer} />)}</div></section>
  </div><Link className="pricing-mobile-cta" href={stickyPlan.href} data-analytics-event={audience === "business" ? "business_plan_selection" : "agency_plan_selection"} data-analytics-placement="mobile_sticky">{mode === "agent-service" ? stickyPlan.cta : audience === "business" ? "Choose Growth" : "Choose Agency Growth"} <Arrow /></Link><MarketingFooter /></main>;
}
