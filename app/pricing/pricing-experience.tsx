"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Arrow, MarketingFooter, MarketingHeader } from "../marketing-shared";
import { formatUsd, pricingAddOns, pricingFaq, pricingPlans, type BillingCadence, type PricingAudience } from "../pricing-catalog";

function SegmentedControl({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return <div className="pricing-control"><span>{label}</span><div role="group" aria-label={label}>{options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></div>;
}

function PricingFaq({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = `pricing-${question.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <article className="pricing-faq-item"><h3><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><span>{question}</span><i aria-hidden="true">{open ? "−" : "+"}</i></button></h3>{open && <p id={id}>{answer}</p>}</article>;
}

export default function PricingExperience() {
  const [audience, setAudience] = useState<PricingAudience>("business");
  const [billing, setBilling] = useState<BillingCadence>("monthly");
  const [revenue, setRevenue] = useState(2500);
  const [margin, setMargin] = useState(45);
  const [closeRate, setCloseRate] = useState(30);
  const [selectedPlan, setSelectedPlan] = useState("growth");
  const plans = pricingPlans.filter(plan => plan.audience === audience);
  const calculatorPlans = pricingPlans.filter(plan => plan.audience === audience);
  const activePlan = calculatorPlans.find(plan => plan.slug === selectedPlan) ?? calculatorPlans[0];
  const monthlyPlanCost = billing === "monthly" ? activePlan.monthly : activePlan.annual / 12;
  const grossProfit = Math.max(0, revenue) * Math.min(100, Math.max(0, margin)) / 100;
  const salesToCover = grossProfit > 0 ? monthlyPlanCost / grossProfit : 0;
  const leadsToCover = closeRate > 0 ? salesToCover / (Math.min(100, closeRate) / 100) : 0;
  const stickyPlan = audience === "business" ? pricingPlans.find(plan => plan.slug === "growth")! : pricingPlans.find(plan => plan.slug === "agency-growth")!;

  const changeAudience = (next: string) => {
    const typed = next as PricingAudience;
    setAudience(typed);
    setSelectedPlan(typed === "business" ? "growth" : "agency-growth");
    window.dispatchEvent(new CustomEvent("hdseo:marketing", { detail: { event: "pricing_audience_toggle", context: { audience: typed }, occurredAt: new Date().toISOString() } }));
  };
  const changeBilling = (next: string) => {
    const typed = next as BillingCadence;
    setBilling(typed);
    window.dispatchEvent(new CustomEvent("hdseo:marketing", { detail: { event: "pricing_billing_toggle", context: { billing: typed }, occurredAt: new Date().toISOString() } }));
  };

  const priceLabel = useMemo(() => billing === "monthly" ? "/month" : "/year", [billing]);

  return <main className="marketing-site pricing-site"><a className="skip-link" href="#pricing-main">Skip to pricing</a><MarketingHeader /><div id="pricing-main">
    <section className="pricing-hero"><span className="m-eyebrow light">CONTROLLED IMPLEMENTATION · MEASURABLE OUTCOMES</span><h1>SEO software that does the approved work—not just the reporting.</h1><p>Choose the implementation capacity that fits your business or agency. Every plan keeps publishing and external spending under your control.</p><div className="pricing-controls"><SegmentedControl label="Choose your audience" value={audience} onChange={changeAudience} options={[{ value: "business", label: "Business" }, { value: "agency", label: "Agency" }]} /><SegmentedControl label="Billing frequency" value={billing} onChange={changeBilling} options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annual — 2 months free" }]} /></div><div className="pricing-hero-links"><Link href="/audit" data-analytics-event="primary_audit_cta_click" data-analytics-placement="pricing_hero">Start with a free audit</Link><Link href="/book-demo?audience=agency" data-analytics-event="agency_cta_click" data-analytics-placement="pricing_hero">Agency walkthrough</Link></div></section>

    <section className="pricing-card-section" aria-live="polite"><header><span className="m-eyebrow">{audience === "business" ? "BUSINESS PLANS" : "AGENCY PLANS"}</span><h2>{audience === "business" ? "From foundational fixes to multi-location growth." : "Pay for active client websites—not seats."}</h2><p>{audience === "business" ? "All plans combine research, approval-controlled implementation, validation, and outcome reporting." : "Add unlimited team members and read-only client viewers without per-seat charges."}</p></header><div className="pricing-grid">{plans.map(plan => <article id={plan.slug} key={plan.slug} className={plan.label ? "recommended" : ""} tabIndex={0} aria-label={`${plan.name} plan, ${formatUsd(billing === "monthly" ? plan.monthly : plan.annual)} ${priceLabel}`}>
      {plan.label && <strong className="pricing-badge">{plan.label}</strong>}<span className="plan-audience">{plan.audience === "agency" ? "AGENCY" : "BUSINESS"}</span><h2>{plan.name}</h2><div className="plan-price"><strong>{formatUsd(billing === "monthly" ? plan.monthly : plan.annual)}</strong><span>{priceLabel}</span></div>{billing === "annual" && <small className="annual-note">Equivalent to {formatUsd(plan.annual / 12)}/month · 2 months free</small>}<p>{plan.description}</p><Link href={plan.href} data-analytics-event={plan.audience === "agency" ? "agency_plan_selection" : "business_plan_selection"} data-analytics-placement={plan.slug}>{plan.cta}<Arrow /></Link>{plan.supportingText && <small className="plan-support">{plan.supportingText}</small>}<ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
    </article>)}</div></section>

    <section className="budget-band"><div><span className="m-eyebrow light">SUBSCRIPTION VS. OPTIONAL SPENDING</span><h2>One pays for HD SEO. The other is always your decision.</h2></div><div><p>Your HD SEO subscription pays for the platform, research, automation, approved implementation capacity, validation, and reporting. Your optional SEO spending budget covers separately approved third-party expenses such as citations, outreach, premium data, specialist work, or other external services. HD SEO never spends that budget automatically.</p><ul><li>No surprise usage charges.</li><li>No automatic external spending.</li><li>Overages require approval.</li><li>Large custom projects are scoped before work begins.</li><li>Rankings, leads, and revenue are not guaranteed.</li><li>Monthly subscriptions can be cancelled at the end of the billing period.</li></ul></div></section>

    <section className="addon-section"><header><span className="m-eyebrow">OPTIONAL ADD-ONS</span><h2>Add capacity without changing the operating model.</h2></header><div>{pricingAddOns.map(([name, price]) => <article key={name}><span>{name}</span><strong>{price}</strong></article>)}</div></section>

    <section className="enterprise-band"><div><span className="m-eyebrow light">ENTERPRISE</span><h2>Custom — starting at $2,500/month</h2><p>For multi-location and multi-brand organizations that need custom limits, infrastructure, governance, and support.</p></div><ul><li>Custom client and website limits</li><li>SSO and role-based access controls</li><li>Audit exports and custom retention policies</li><li>Dedicated infrastructure options</li><li>Provider rate-limit management</li><li>Advanced security reviews and custom SLAs</li><li>Dedicated onboarding and support</li></ul><Link href="/enterprise" data-analytics-event="enterprise_cta_click" data-analytics-placement="pricing_enterprise">Book an Enterprise Review <Arrow /></Link></section>

    <section className="comparison-section"><header><span className="m-eyebrow">VALUE COMPARISON</span><h2>Compare who turns the recommendation into finished work.</h2></header><div className="comparison-table" role="table" aria-label="SEO solution value comparison"><div role="row" className="comparison-head"><span role="columnheader">Option</span><span role="columnheader">Typical monthly cost</span><span role="columnheader">What it primarily provides</span><span role="columnheader">Who completes the work</span></div><div role="row"><strong role="cell">DIY SEO tools</strong><span role="cell">Approx. $29–$250</span><span role="cell">Data, reports, and recommendations</span><span role="cell">Usually the customer</span></div><div role="row"><strong role="cell">Traditional SEO agency</strong><span role="cell">Approx. $799–$1,299+ per location</span><span role="cell">Human-managed service; scope varies</span><span role="cell">The provider</span></div><div role="row" className="comparison-hd"><strong role="cell">HD SEO</strong><span role="cell">Starts at $199</span><span role="cell">Discovery, preparation, validation, measurement, and controls</span><span role="cell">HD SEO completes approved work through supported connections</span></div></div><p className="market-note">Market ranges are illustrative and may change. Compare scope, implementation, limits, and contract terms—not price alone.</p></section>

    <section className="roi-section"><div><span className="m-eyebrow light">BREAK-EVEN PLANNER</span><h2>How much new business would cover the subscription?</h2><p>Use your own economics to understand the break-even point. This planning math is not a forecast.</p></div><form onSubmit={event => event.preventDefault()}><label>Average customer or job revenue<span>$<input type="number" min="0" step="100" value={revenue} onChange={event => setRevenue(Number(event.target.value))} /></span></label><label>Gross-profit margin<span><input type="number" min="0" max="100" step="1" value={margin} onChange={event => setMargin(Number(event.target.value))} />%</span></label><label>Lead-to-sale close rate<span><input type="number" min="1" max="100" step="1" value={closeRate} onChange={event => setCloseRate(Number(event.target.value))} />%</span></label><label>Selected HD SEO plan<select value={activePlan.slug} onChange={event => setSelectedPlan(event.target.value)}>{calculatorPlans.map(plan => <option key={plan.slug} value={plan.slug}>{plan.name} — {formatUsd(billing === "monthly" ? plan.monthly : plan.annual)}{priceLabel}</option>)}</select></label></form><div className="roi-results"><article><span>Estimated gross profit per new sale</span><strong>{formatUsd(grossProfit)}</strong></article><article><span>Approximate additional sales needed to cover one month</span><strong>{salesToCover > 0 ? salesToCover.toFixed(2) : "—"}</strong></article><article><span>Approximate qualified leads at your close rate</span><strong>{leadsToCover > 0 ? leadsToCover.toFixed(1) : "—"}</strong></article></div><small>Planning estimate only. This calculator does not predict or guarantee rankings, leads, sales, revenue, profit, or return.</small></section>

    <section className="pricing-faq"><header><span className="m-eyebrow">PRICING FAQ</span><h2>Know what you pay for and what stays under approval.</h2><p>Existing customers can <Link href="/login/client">sign in as a business</Link> or <Link href="/login/agency">sign in as an agency</Link>.</p></header><div>{pricingFaq.map(([question, answer]) => <PricingFaq key={question} question={question} answer={answer} />)}</div></section>
  </div><Link className="pricing-mobile-cta" href={stickyPlan.href} data-analytics-event={audience === "business" ? "business_plan_selection" : "agency_plan_selection"} data-analytics-placement="mobile_sticky">{audience === "business" ? "Choose Growth" : "Choose Agency Growth"} <Arrow /></Link><MarketingFooter /></main>;
}
