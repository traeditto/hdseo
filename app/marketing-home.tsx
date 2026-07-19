"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const opportunities = [
  { name: "Roof repair decision page", market: "Jacksonville, FL", evidence: "Search Console + competitor gap", score: "High", risk: "Low", effort: "Moderate", budget: "Standard", value: "High", confidence: "High", action: "Prepare decision page" },
  { name: "Storm damage service cluster", market: "Duval County, FL", evidence: "Demand confirmed; proof review pending", score: "High", risk: "Moderate", effort: "High", budget: "Expanded", value: "High", confidence: "Moderate", action: "Validate business proof" },
  { name: "Emergency repair FAQ", market: "Approved service area", evidence: "Customer questions + internal search", score: "Moderate", risk: "Low", effort: "Low", budget: "Focused", value: "Moderate", confidence: "High", action: "Draft and add schema" },
  { name: "Northside location expansion", market: "Jacksonville Northside", evidence: "Service coverage not yet confirmed", score: "Awaiting evidence", risk: "Moderate", effort: "Moderate", budget: "On hold", value: "Awaiting evidence", confidence: "Low", action: "Confirm service coverage" },
];

const workflow = [
  ["Collect evidence", "Onboarding Agent"], ["Discover opportunities", "Research Agent"], ["Prioritize by value", "Strategy Agent"],
  ["Prepare the work", "Technical, Content & Local SEO Agents"], ["Request approval", "Supervisor Agent"], ["Publish safely", "Implementation Agent"],
  ["Validate the result", "QA Agent"], ["Monitor performance", "Reporting Agent"], ["Learn and improve", "Supervisor Agent"],
];

const comparisonRows = [
  ["Discovers opportunities automatically", "Limited", "Limited", "Built in"], ["Enforces service-area relevance", "Varies", "No", "Built in"],
  ["Scores expected business value", "Limited", "No", "Built in"], ["Uses first-party evidence", "Varies", "Limited", "Built in"],
  ["Creates an accountable plan", "Manual", "No", "Built in"], ["Supports human approval", "Varies", "Varies", "Built in"],
  ["Implements website changes", "No", "Limited", "Controlled"], ["Creates GitHub pull requests", "No", "Limited", "Supported"],
  ["Publishes through connected CMS platforms", "No", "Limited", "Supported"], ["Validates technical SEO", "Reports", "Limited", "Built in"],
  ["Monitors deployments", "No", "No", "Built in"], ["Supports rollback", "No", "No", "Supported"],
  ["Tracks actual SEO spending", "Limited", "No", "Built in"], ["Connects work to leads and revenue", "Varies", "No", "Built in"],
  ["Supports agencies and white-label delivery", "Varies", "Varies", "Built in"], ["Maintains a complete audit trail", "Varies", "Limited", "Built in"],
];

const integrations = ["Google Search Console", "Google Analytics 4", "Google Business Profile", "CallRail", "HubSpot", "GitHub", "Vercel", "DataForSEO", "WordPress", "Shopify", "Webflow"];
const governance = ["Tenant isolation", "Role-based permissions", "Tool-specific authorization", "Spending limits", "Risk classifications", "Human approval gates", "Idempotent jobs", "Bounded retries", "Dead-letter recovery", "Encrypted secrets", "Complete audit history", "Evidence-backed claims", "Deployment rollback", "Per-client policies"];

function Logo() {
  return <span className="m-logo"><span className="m-logo-mark" aria-hidden="true"><i /><b /></span><span>HD <em>SEO</em></span></span>;
}

function Arrow() { return <span aria-hidden="true">↗</span>; }

function SectionHeading({ eyebrow, title, copy, center = false }: { eyebrow?: string; title: string; copy?: string; center?: boolean }) {
  return <header className={`m-section-heading${center ? " centered" : ""}`}>{eyebrow && <span className="m-eyebrow">{eyebrow}</span>}<h2>{title}</h2>{copy && <p>{copy}</p>}</header>;
}

function HeroDemo() {
  const [stage, setStage] = useState(0);
  const stages = ["Analyzing website", "Opportunity found", "Value assessed", "Owner approved", "Change prepared", "QA passed", "Outcome tracking"];
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setStage((value) => (value + 1) % stages.length), 2100);
    return () => window.clearInterval(timer);
  }, [stages.length]);
  return <div className="hero-product" aria-label="Animated HD SEO autonomous workflow demonstration">
    <div className="product-top"><div><span className="window-dot" /><span className="window-dot" /><span className="window-dot" /></div><span>LIVE WORKSPACE · HARBOR ROOFING</span><b>Protected</b></div>
    <div className="product-shell">
      <aside aria-hidden="true"><Logo /><span className="side-active">⌁</span><span>◇</span><span>↗</span><span>✓</span></aside>
      <div className="product-main">
        <div className="product-status"><div><small>AUTONOMOUS WORKFLOW</small><strong>{stages[stage]}</strong></div><span className={`status-light s${stage}`} /> </div>
        <div className="scan-panel">
          <div className="scan-head"><div><small>RECOMMENDED NEXT ACTION</small><h3>Roof repair decision page</h3></div><span>HIGH VALUE</span></div>
          <p>Jacksonville, FL · Within approved service area</p>
          <div className="evidence-grid"><span><small>Evidence</small><b>Search Console + market gap</b></span><span><small>Confidence</small><b>High</b></span><span><small>Risk</small><b>Low</b></span><span><small>Effort</small><b>Moderate</b></span></div>
          <div className="demo-progress"><i style={{ width: `${((stage + 1) / stages.length) * 100}%` }} /></div>
          <div className="demo-actions"><button type="button" className={stage === 3 ? "approved" : ""} onClick={() => setStage(3)}>{stage >= 3 ? "✓ Approved" : "Approve"}</button><button type="button">Review evidence</button></div>
        </div>
        <div className="demo-states"><span><i className="loading-dot" /> Search analysis</span><span className={stage >= 5 ? "success" : ""}>✓ Technical QA</span><span className="needs-input">! GA4 connection needed</span></div>
      </div>
    </div>
    <div className="stage-dots" aria-label="Select workflow stage">{stages.map((item, index) => <button type="button" key={item} className={index === stage ? "active" : ""} onClick={() => setStage(index)} aria-label={`Show stage: ${item}`} />)}</div>
  </div>;
}

function OpportunityRanking() {
  const [selected, setSelected] = useState(0);
  const active = opportunities[selected];
  return <div className="ranking-lab">
    <div className="ranking-list" role="list" aria-label="Ranked SEO opportunities">
      <div className="ranking-list-head"><span>Ranked opportunities</span><b>Value / confidence</b></div>
      {opportunities.map((item, index) => <button type="button" role="listitem" key={item.name} className={selected === index ? "active" : ""} onClick={() => setSelected(index)}>
        <span className="rank-number">0{index + 1}</span><span><strong>{item.name}</strong><small>{item.market}</small></span><span className={`value-label ${item.score.toLowerCase().replace(" ", "-")}`}>{item.score}</span>
      </button>)}
    </div>
    <article className="opportunity-inspector" aria-live="polite"><header><span className="m-eyebrow">OPPORTUNITY BRIEF</span><em>{active.risk} risk</em></header><h3>{active.name}</h3><p>{active.market}</p>
      <dl><div><dt>Current evidence</dt><dd>{active.evidence}</dd></div><div><dt>Opportunity score</dt><dd>{active.score}</dd></div><div><dt>Estimated effort</dt><dd>{active.effort}</dd></div><div><dt>Recommended budget</dt><dd>{active.budget}</dd></div><div><dt>Expected value</dt><dd>{active.value}</dd></div><div><dt>Confidence</dt><dd>{active.confidence}</dd></div></dl>
      <div className="next-action"><small>PROPOSED NEXT ACTION</small><strong>{active.action}</strong><button type="button">Review evidence <Arrow /></button></div>
    </article>
  </div>;
}

function OwnerRecommendation() {
  return <div className="owner-recommendation"><div className="owner-ui-top"><Logo /><span>Today · Jacksonville, FL</span><b>One action ready</b></div><div className="owner-ui-body"><span className="m-eyebrow">TODAY&apos;S RECOMMENDATION</span><h3>Create a dedicated roof-repair decision page for Jacksonville homeowners.</h3><div className="owner-explain"><section><small>WHY IT MATTERS</small><p>Search Console and competitor evidence indicate an underserved high-intent opportunity within your approved service area.</p></section><section><small>WHAT HD SEO WILL DO</small><p>Prepare the page, add internal links, validate schema and metadata, request approval, and monitor performance.</p></section></div><div className="owner-buttons"><button type="button">Approve</button><button type="button">Review details</button><button type="button">Not now</button></div></div></div>;
}

function AgencyView() {
  return <div className="agency-view"><div className="agency-bar"><div><span className="m-eyebrow">CLIENT COMMAND CENTER</span><h3>Portfolio overview</h3></div><span>White-label preview</span></div><div className="agency-summary"><article><small>CLIENT HEALTH</small><strong>On track</strong><span>Evidence current</span></article><article><small>AWAITING APPROVAL</small><strong>Review</strong><span>Owner decision needed</span></article><article><small>BUDGET</small><strong>Within policy</strong><span>No limit alerts</span></article></div><div className="agency-clients"><article><span>HB</span><div><strong>Harbor Roofing</strong><small>Jacksonville · Service area</small></div><em>2 ready</em></article><article><span>NP</span><div><strong>Northline Plumbing</strong><small>Orlando · Multi-location</small></div><em className="clear">Healthy</em></article><article><span>AC</span><div><strong>Avery Construction</strong><small>Tampa Bay · Service area</small></div><em className="blocked">Connect data</em></article></div><footer><span>Deployment status</span><b>All monitored sites healthy</b><span>Client-visible reporting ready</span></footer></div>;
}

export default function MarketingHome() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <main className="marketing-site">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <nav className="m-nav" aria-label="Primary navigation"><Link href="/" aria-label="HD SEO home"><Logo /></Link><div className={`m-nav-links${menuOpen ? " open" : ""}`}>
      <a href="#platform" onClick={() => setMenuOpen(false)}>Platform</a><a href="#workflow" onClick={() => setMenuOpen(false)}>How It Works</a><a href="#business" onClick={() => setMenuOpen(false)}>For Businesses</a><a href="#agencies" onClick={() => setMenuOpen(false)}>For Agencies</a><a href="#integrations" onClick={() => setMenuOpen(false)}>Integrations</a><a href="#security" onClick={() => setMenuOpen(false)}>Security</a><a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a><Link href="/login/client">Sign In</Link>
    </div><div className="m-nav-actions"><Link className="nav-cta" href="/audit">Start My SEO Plan <Arrow /></Link><button className="menu-toggle" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Toggle navigation"><span /><span /></button></div></nav>

    <div id="main-content">
      <section className="hero"><div className="hero-grid" aria-hidden="true" /><div className="hero-copy"><span className="m-eyebrow light">AUTONOMOUS SEO, ACCOUNTABLE RESULTS</span><h1>Turn SEO into a<br /><em>measurable growth system.</em></h1><p>HD SEO finds the best opportunities for your market, prepares and implements approved improvements, verifies every deployment, and connects the work to rankings, leads, revenue, and real SEO spend.</p><div className="hero-actions"><Link className="primary-button" href="/audit">Start My SEO Plan <Arrow /></Link><a className="secondary-button" href="#workflow">Watch the Autonomous Workflow <span>↓</span></a></div><small className="trust-line"><i>✓</i> No keyword spreadsheets required. No unexplained activity reports. No publishing without your rules and approval.</small></div><HeroDemo /></section>

      <section className="problem-section" id="platform"><SectionHeading title="Most SEO software gives you more work." copy="The gap is not access to data. It is turning evidence into the right decision, safely executed and measured." /><div className="problem-list"><article><span>01</span><h3>Keyword overload</h3><p>Traditional tools return thousands of keywords and expect the customer to decide what matters.</p></article><article><span>02</span><h3>Activity without accountability</h3><p>Reports show impressions, tasks, and content volume without showing whether the work generated qualified opportunities.</p></article><article><span>03</span><h3>Recommendations without execution</h3><p>Most platforms identify problems but still require an expert, developer, or agency to implement everything.</p></article></div><p className="transition-copy">HD SEO connects <b>research, decisions, implementation, validation,</b> and <b>outcome measurement</b> in one controlled system.</p></section>

      <section className="comparison-section"><SectionHeading eyebrow="A COMPLETE OPERATING LOOP" title="From SEO recommendations to verified execution." /><div className="comparison-wrap" tabIndex={0} aria-label="Feature comparison table. Scroll horizontally on smaller screens."><table><thead><tr><th>Capability</th><th>Traditional SEO Tools</th><th>AI Content Tools</th><th>HD SEO</th></tr></thead><tbody>{comparisonRows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell} className={index === 3 ? "hd-cell" : ""}>{index === 3 && <span>✓</span>}{cell}</td>)}</tr>)}</tbody></table></div><p className="table-note">Category-level comparison based on typical product behavior. Exact capabilities vary by provider and configuration.</p></section>

      <section className="roi-section"><SectionHeading eyebrow="SEO INVESTMENT INTELLIGENCE" title="Put the next dollar where it can create the most value." copy="Every opportunity is evaluated using search demand, commercial intent, current position, service-area relevance, competition, authority, conversion potential, cost, evidence confidence, and expected business value." /><OpportunityRanking /><p className="roi-note">Traffic is not the final outcome. HD SEO separates directional search value from verified leads, sales, gross profit, and actual return.</p></section>

      <section className="workflow-section" id="workflow"><SectionHeading eyebrow="AUTONOMOUS WORKFLOW" title="One closed loop from evidence to outcome." copy="Agents operate within permissions, budgets, risk classifications, and approval rules. They are purpose-built operators—not unrestricted chatbots." center /><div className="workflow-line">{workflow.map(([stage, agent], index) => <article key={stage}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{stage}</h3><p>{agent}</p></div>{index < workflow.length - 1 && <i aria-hidden="true">→</i>}</article>)}</div></section>

      <section className="owner-section" id="business"><div className="owner-copy"><SectionHeading eyebrow="BUILT FOR PEOPLE WHO DO NOT WANT TO BECOME SEO EXPERTS" title="You run the business. HD SEO handles the complexity." copy="Business owners see recommendations, approvals, completed work, leads, rankings, money spent, and value produced—not technical clutter." /><ul><li><span>01</span> One clear next action</li><li><span>02</span> Evidence in plain language</li><li><span>03</span> Approval before meaningful change</li></ul></div><OwnerRecommendation /></section>

      <section className="agency-section" id="agencies"><div className="agency-copy"><SectionHeading eyebrow="WHITE-LABEL SEO OPERATIONS" title="Manage every client from one accountable workspace." copy="Organize work around clients first: health, approvals, opportunities, campaigns, blocked integrations, budgets, deployments, ranking movement, qualified leads, and client-visible reporting." /><p>Apply your own branding, permissions, pricing, approval policies, reporting language, and service model while HD SEO manages the underlying workflows.</p><Link href="/login/agency">Explore the agency workspace <Arrow /></Link></div><AgencyView /></section>

      <section className="creative-section"><div className="creative-visual"><span className="m-eyebrow">EVIDENCE COMPOSITION</span><div className="signal-map"><span>Search intent</span><span>Business facts</span><span>Local conditions</span><span>Project proof</span><span>Customer questions</span><span>Competitor gaps</span><b>Original page brief</b></div></div><div><SectionHeading title="Create pages competitors cannot copy." copy="HD SEO combines real search intent, first-party Search Console evidence, approved business facts, actual services and markets, customer questions, local conditions, original project proof, existing page performance, competitor gaps, internal-link relationships, and conversion intent." /><blockquote>Every recommendation includes its evidence, intended search purpose, target audience, approval status, validation requirements, and measurement plan.</blockquote><p>Quality and relevance come first—never mass-produced city swaps, doorway pages, or low-value AI content.</p></div></section>

      <section className="local-section"><SectionHeading eyebrow="LOCAL MARKET CONTROL" title="Local relevance is enforced, not assumed." copy="Select approved cities, counties, regions, or service radiuses. HD SEO rejects irrelevant out-of-market keywords and evaluates opportunities inside the business’s real operating area." center /><div className="market-modes"><article><span>01</span><h3>Service area</h3><p>Work only inside the cities, counties, regions, or radius your team approves.</p></article><article><span>02</span><h3>Multi-location</h3><p>Separate location facts, permissions, coverage, and measurement by market.</p></article><article><span>03</span><h3>Nationwide</h3><p>Apply consistent governance while prioritizing distinct commercial opportunities.</p></article></div><div className="local-capabilities"><span>Google Search Console</span><span>Google Business Profile*</span><span>Local ranking visibility</span><span>Review opportunity monitoring</span><span>Service-area keyword discovery</span><span>Location coverage analysis</span><span>Citation monitoring</span><span>Local content planning</span></div><small>* Google Business Profile edits require configured permissions and approvals.</small></section>

      <section className="implementation-section"><div><SectionHeading eyebrow="CONTROLLED IMPLEMENTATION" title="Recommendations become controlled action." copy="Choose the path that fits your stack and your risk policy. Every route can include a preview, approval, change history, technical validation, health checks, and rollback protection." /><div className="implementation-paths">{["GitHub + Vercel", "WordPress", "Shopify", "Webflow", "Squarespace-guided", "Developer handoff", "Monitoring-only"].map((path, index) => <span key={path}><i>{index < 4 ? "Connected" : "Available"}</i>{path}</span>)}</div></div><div className="qa-panel"><header><span className="m-eyebrow">RELEASE VALIDATION</span><b>QA policy: Standard</b></header>{["Technical SEO", "Sitemap + robots", "Schema validation", "Link validation", "Lighthouse checks", "Deployment monitoring", "Rollback protection"].map((check, index) => <div key={check}><span>{check}</span><b>{index < 5 ? "✓ Pass" : "Monitoring"}</b></div>)}</div></section>

      <section className="outcomes-section"><SectionHeading eyebrow="VERIFIED OUTCOMES" title="Know what the work produced." copy="Estimates, measured performance, and confirmed business outcomes stay clearly separated." /><div className="outcome-board"><div className="metric-boundary"><span>ESTIMATED</span><article><small>Directional search value</small><strong>Planning signal</strong><em>Not revenue</em></article></div><div className="metric-boundary"><span>MEASURED</span><article><small>Organic sessions · Rankings</small><strong>Performance evidence</strong><em>Connected sources</em></article></div><div className="metric-boundary verified"><span>VERIFIED</span><article><small>Qualified leads · Calls · Forms · Bookings</small><strong>Confirmed outcomes</strong><em>Attribution controlled</em></article></div></div><div className="verified-metrics">{["Actual SEO spend", "Closed sales", "Recorded revenue", "Gross profit", "Cost per qualified lead", "Return on verified SEO spend"].map(metric => <span key={metric}>✓ {metric}</span>)}</div><p>HD SEO never presents estimated traffic value as verified revenue.</p></section>

      <section className="integrations-section" id="integrations"><span className="m-eyebrow">CONNECTED EVIDENCE & EXECUTION</span><div>{integrations.map((item) => <span key={item}>{item}</span>)}</div></section>

      <section className="governance-section" id="security"><div><SectionHeading eyebrow="SAFETY & GOVERNANCE" title="Autonomous does not mean uncontrolled." copy="HD SEO is designed for bounded action, recoverable execution, and evidence-backed accountability across every client and market." /><p className="risk-callout">DNS, legal, pricing, destructive changes, external spending, and high-risk publishing remain approval-gated.</p></div><div className="governance-list">{governance.map((item, index) => <span key={item}><i>{String(index + 1).padStart(2, "0")}</i>{item}<b>✓</b></span>)}</div></section>

      <section className="how-section"><SectionHeading title="From connected site to accountable action." center /><div className="four-steps"><article><span>01</span><h3>Connect your website</h3><p>Use GitHub, WordPress, Shopify, Webflow, or a guided website connection.</p></article><article><span>02</span><h3>Tell us about your business</h3><p>Define services, service areas, goals, economics, permissions, and budget.</p></article><article><span>03</span><h3>Review your growth plan</h3><p>HD SEO discovers and prioritizes the best opportunities automatically.</p></article><article><span>04</span><h3>Approve results-focused work</h3><p>HD SEO prepares, implements, validates, and monitors approved actions.</p></article></div></section>

      <section className="pricing-section" id="pricing"><SectionHeading eyebrow="A PATH FOR EVERY OPERATING MODEL" title="Accountability scales with you." center /><div className="pricing-grid"><article><span>FOR OWNERS</span><h3>Business</h3><p>For owners who want a guided, simple growth system.</p><ul><li>Clear recommendations</li><li>Approval-led execution</li><li>Outcome-focused reporting</li></ul><Link href="/audit">Join early access <Arrow /></Link></article><article className="featured"><span>FOR TEAMS</span><h3>Agency</h3><p>For teams managing multiple client websites.</p><ul><li>White-label delivery</li><li>Portfolio controls</li><li>Client-ready reporting</li></ul><a href="mailto:hello@hdseo.com?subject=HD%20SEO%20Agency%20access">Contact us <Arrow /></a></article><article><span>FOR COMPLEXITY</span><h3>Enterprise</h3><p>For multi-location brands, advanced governance, and custom infrastructure.</p><ul><li>Role-based governance</li><li>Multi-location operations</li><li>Custom infrastructure</li></ul><a href="mailto:hello@hdseo.com?subject=HD%20SEO%20Enterprise%20walkthrough">Book a walkthrough <Arrow /></a></article></div></section>

      <section className="faq-section" id="faq"><SectionHeading eyebrow="QUESTIONS, ANSWERED" title="What accountable autonomy means." /><div>{[["Does HD SEO publish changes automatically?", "Only within the permissions, risk rules, budgets, and approval policies you configure. High-risk work remains approval-gated."], ["Is HD SEO only for SEO experts?", "No. Owners get a simple recommendation-and-approval experience; agencies and enterprise teams can use deeper controls."], ["How does HD SEO measure return?", "It separates estimates from measured performance and confirmed outcomes such as qualified leads, recorded revenue, gross profit, and actual SEO spend."], ["Which websites can HD SEO work with?", "HD SEO supports GitHub and Vercel, WordPress, Shopify, Webflow, guided implementation, developer handoff, and monitoring-only setups."]].map(([q, a]) => <details key={q}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div></section>

      <section className="final-cta" id="contact"><span className="m-eyebrow light">THE NEXT ACTION, MADE ACCOUNTABLE</span><h2>Stop buying SEO activity.<br /><em>Start investing in accountable growth.</em></h2><p>Connect your website and let HD SEO identify the safest, highest-value action your business can take next.</p><div><Link className="primary-button" href="/audit">Start My SEO Plan <Arrow /></Link><a className="secondary-button" href="mailto:hello@hdseo.com?subject=HD%20SEO%20Platform%20Walkthrough">Book a Platform Walkthrough</a></div></section>
    </div>

    <footer className="m-footer"><div className="footer-brand"><Logo /><p>Agent-first SEO operations.<br />Evidence in. Accountable growth out.</p></div><div className="footer-links"><div><strong>PLATFORM</strong><a href="#platform">Platform</a><a href="#workflow">How it works</a><a href="#integrations">Integrations</a><a href="#security">Security</a></div><div><strong>SOLUTIONS</strong><a href="#business">Business Owners</a><a href="#agencies">Agencies</a><a href="#pricing">Enterprise</a></div><div><strong>COMPANY</strong><a href="#faq">Documentation</a><a href="mailto:privacy@hdseo.com">Privacy</a><a href="mailto:legal@hdseo.com">Terms</a><a href="mailto:hello@hdseo.com">Contact</a></div></div><div className="footer-bottom"><span>© 2026 HD SEO. All rights reserved.</span><Link href="/login/client">Sign In <Arrow /></Link></div></footer>
  </main>;
}
