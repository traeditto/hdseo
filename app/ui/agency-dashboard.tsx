"use client";

import { useMemo, useState } from "react";

type NavItem = { label: string; glyph: string; count?: number };

const navigation: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: "Command center", glyph: "⌂" },
      { label: "Next best actions", glyph: "↗", count: 18 },
      { label: "Clients", glyph: "◇" },
      { label: "Work queue", glyph: "✓", count: 7 },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { label: "Rankings", glyph: "⌁" },
      { label: "Site audits", glyph: "◎" },
      { label: "Competitors", glyph: "◫" },
      { label: "Reports", glyph: "▤" },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { label: "Executions", glyph: "⌘" },
      { label: "Approvals", glyph: "◉", count: 4 },
      { label: "Team", glyph: "♙" },
      { label: "Integrations", glyph: "⇄" },
    ],
  },
];

const metrics = [
  { label: "ACTIVE CLIENTS", value: "12", detail: "2 onboarding", trend: "+2", tone: "positive" },
  { label: "OPEN OPPORTUNITIES", value: "47", detail: "8 high priority", trend: "+8", tone: "positive" },
  { label: "AWAITING APPROVAL", value: "4", detail: "Oldest: 3 days", trend: "Review", tone: "warning" },
  { label: "RANKING WINS", value: "23", detail: "Past 30 days", trend: "+14%", tone: "positive" },
];

const clients = [
  { name: "Kingdom Roofing", initials: "KR", color: "clay", project: "Main Website", health: 86, status: "Strong", action: "Improve ‘roof repair Jacksonville’", score: 94, tasks: 3, trend: "+12", refresh: "18 min ago" },
  { name: "Northwind HVAC", initials: "NH", color: "blue", project: "NorthwindComfort.com", health: 72, status: "Healthy", action: "Build ‘AC repair Ponte Vedra’", score: 87, tasks: 5, trend: "+6", refresh: "2 hours ago" },
  { name: "Coastal Plumbing", initials: "CP", color: "teal", project: "CoastalPlumbingFL.com", health: 61, status: "Attention", action: "Defend ‘emergency plumber’", score: 83, tasks: 4, trend: "−4", refresh: "5 hours ago" },
  { name: "Canopy Tree Care", initials: "CT", color: "gold", project: "CanopyTreeExperts.com", health: 78, status: "Healthy", action: "Fix duplicate location pages", score: 79, tasks: 2, trend: "+8", refresh: "Yesterday" },
];

const queue = [
  { title: "Review roof repair execution draft", client: "Kingdom Roofing", meta: "Content · Assigned to Maya Chen", priority: "HIGH", due: "Today", action: "Review" },
  { title: "Approve HVAC service-page changes", client: "Northwind HVAC", meta: "Approval · Assigned to you", priority: "HIGH", due: "Today", action: "Approve" },
  { title: "Investigate Maps visibility decline", client: "Coastal Plumbing", meta: "Maps · Assigned to Jordan Lee", priority: "MED", due: "Tomorrow", action: "Open" },
];

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={small ? "brand-mark small" : "brand-mark"} aria-hidden="true"><i /><b /></span>;
}

export function AgencyDashboard() {
  const [active, setActive] = useState("Command center");
  const [clientFilter, setClientFilter] = useState("All clients");
  const [toast, setToast] = useState<string | null>(null);
  const [showRefresh, setShowRefresh] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  const heading = active === "Command center" ? "Good morning, Olivia" : active;
  const filteredClients = useMemo(() => clientFilter === "All clients" ? clients : clients.filter((client) => client.name === clientFilter), [clientFilter]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand"><BrandMark /><span>HD <em>SEO</em></span><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation">×</button></div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">NA</div>
          <div><span>WORKSPACE</span><strong>HD SEO Agency</strong></div>
          <button aria-label="Switch workspace">⌄</button>
        </div>
        <nav aria-label="Primary navigation">
          {navigation.map((group, index) => (
            <div className="nav-group" key={index}>
              {group.label && <div className="nav-label">{group.label}</div>}
              {group.items.map((item) => (
                <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => { setActive(item.label); setMobileNav(false); }}>
                  <span className="nav-glyph">{item.glyph}</span><span>{item.label}</span>{item.count && <small>{item.count}</small>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="usage-row"><span>Monthly data usage</span><strong>$84 / $150</strong></div>
          <div className="usage-track"><i /></div>
          <p>56% of agency allowance</p>
          <button className="profile-card"><span>OM</span><div><strong>Olivia Martin</strong><small>Agency owner</small></div><b>•••</b></button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button>
          <div className="breadcrumbs"><span>HD SEO Agency</span><b>/</b><strong>{active}</strong></div>
          <div className="top-actions"><button aria-label="Search">⌕</button><button className="notification" aria-label="Notifications">♢<i /></button><button className="add-client" onClick={() => notify("New client onboarding opened")}>＋ Add client</button></div>
        </header>

        <div className="content">
          <div className="demo-banner"><span>DEMO DATA</span><p>You’re viewing a synthetic agency workspace. No paid data operations will run.</p><button onClick={() => notify("Demo guide opened")}>View demo guide →</button></div>
          <div className="page-heading">
            <div><h1>{heading}</h1><p>{active === "Command center" ? "Here’s where your agency can create the most SEO value today." : `A focused view of ${active.toLowerCase()} across your client portfolio.`}</p></div>
            <div className="heading-actions"><label><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} aria-label="Filter by client"><option>All clients</option>{clients.map((client) => <option key={client.name}>{client.name}</option>)}</select></label><button className="refresh-button" onClick={() => setShowRefresh(true)}>↻ Refresh data</button></div>
          </div>

          <section className="metrics-grid" aria-label="Agency overview">
            {metrics.map((metric) => <article className="metric-card" key={metric.label}><div className="metric-icon">{metric.label === "ACTIVE CLIENTS" ? "◇" : metric.label === "OPEN OPPORTUNITIES" ? "↗" : metric.label === "AWAITING APPROVAL" ? "◷" : "⌁"}</div><div><span>{metric.label}</span><strong>{metric.value}</strong><p>{metric.detail}</p></div><em className={metric.tone}>{metric.trend}</em></article>)}
          </section>

          <section className="priority-card">
            <div className="priority-ribbon"><span>◆</span> NEXT BEST ACTION <em>HIGHEST VALUE ACROSS ALL CLIENTS</em></div>
            <div className="priority-body">
              <div className="priority-main">
                <div className="client-kicker"><span className="client-avatar clay">KR</span><div><strong>Kingdom Roofing</strong><small>Main Website · Jacksonville, FL</small></div><em>HIGH PRIORITY</em></div>
                <h2>Improve “Roof Repair Jacksonville”</h2>
                <p className="priority-copy">The existing page ranks within striking distance of the Top 3 for a high-intent service query. Stronger coverage and internal-link support are likely to improve its competitive position.</p>
                <div className="why-row"><span>WHY NOW</span><p>Position <b>#6</b> is a realistic milestone opportunity with high commercial value and a clear competitor content gap.</p></div>
                <div className="specific-work">
                  <span>RECOMMENDED WORK</span>
                  <div><i>1</i><p><strong>Strengthen service coverage</strong><small>Add repair types, diagnostic process, and verified service-area details.</small></p></div>
                  <div><i>2</i><p><strong>Improve internal-link support</strong><small>Add contextual links from 4 relevant service and location pages.</small></p></div>
                  <div><i>3</i><p><strong>Review metadata & schema</strong><small>Align the title, description, and Service schema to the target intent.</small></p></div>
                </div>
              </div>
              <aside className="score-panel">
                <span>OPPORTUNITY SCORE</span>
                <div className="score-ring"><strong>94</strong><small>/100</small></div>
                <div className="confidence"><span>Confidence</span><strong>86%</strong><div><i /></div></div>
                <dl><div><dt>Current rank</dt><dd>#6</dd></div><div><dt>Target milestone</dt><dd>Top 3</dd></div><div><dt>Search volume</dt><dd>1,100</dd></div><div><dt>CPC</dt><dd>$38.40</dd></div></dl>
                <button className="primary-action" onClick={() => notify("Implementation draft created")}>Create implementation draft</button>
                <button className="secondary-action" onClick={() => notify("Evidence panel opened")}>View full evidence</button>
              </aside>
            </div>
          </section>

          <section className="data-section client-section">
            <div className="section-header"><div><h2>Client health</h2><p>Portfolio status and highest-priority work</p></div><button onClick={() => setActive("Clients")}>View all clients →</button></div>
            <div className="table-wrap"><table><thead><tr><th>CLIENT</th><th>SEO HEALTH</th><th>HIGHEST-PRIORITY OPPORTUNITY</th><th>OPEN TASKS</th><th>30D TREND</th><th>LAST REFRESH</th><th /></tr></thead><tbody>{filteredClients.map((client) => <tr key={client.name}><td><div className="table-client"><span className={`client-avatar ${client.color}`}>{client.initials}</span><p><strong>{client.name}</strong><small>{client.project}</small></p></div></td><td><div className="health"><strong>{client.health}</strong><span className={client.status === "Attention" ? "attention" : ""}>{client.status}</span></div></td><td><p className="opportunity-name">{client.action}</p><small className="mini-score">Score {client.score}</small></td><td><strong>{client.tasks}</strong></td><td><span className={client.trend.startsWith("+") ? "trend-up" : "trend-down"}>{client.trend}</span></td><td><span className="muted">{client.refresh}</span></td><td><button className="row-menu" aria-label={`More actions for ${client.name}`}>•••</button></td></tr>)}</tbody></table></div>
          </section>

          <section className="data-section queue-section">
            <div className="section-header"><div><h2>Agency work queue</h2><p>Prioritized work that needs attention</p></div><div><button className="filter-button">≡ Filter</button><button onClick={() => setActive("Work queue")}>View full queue →</button></div></div>
            <div className="queue-list">{queue.map((item, index) => <article key={item.title}><span className="queue-number">0{index + 1}</span><div className="queue-copy"><h3>{item.title}</h3><p><strong>{item.client}</strong><span>·</span>{item.meta}</p></div><span className={`priority-pill ${item.priority === "MED" ? "medium" : ""}`}>{item.priority}</span><div className="queue-due"><small>DUE</small><strong>{item.due}</strong></div><button onClick={() => notify(`${item.action} workflow opened`)}>{item.action}</button></article>)}</div>
          </section>
          <footer className="content-footer"><span><BrandMark small /> HD SEO</span><p>Last synced 18 minutes ago · All systems operational</p><button onClick={() => notify("Support center opened")}>? Help & support</button></footer>
        </div>
      </section>

      {showRefresh && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowRefresh(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="refresh-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowRefresh(false)} aria-label="Close">×</button><span className="modal-icon">↻</span><h2 id="refresh-title">Authorize data refresh</h2><p>This demo shows the confirmation required before any paid provider operation. Production requests include scope and estimated cost.</p><div className="cost-box"><span>Estimated scope</span><strong>12 clients · 1,248 keywords</strong><span>Estimated provider cost</span><strong>$4.80–$6.20</strong></div><div className="modal-actions"><button onClick={() => setShowRefresh(false)}>Cancel</button><button onClick={() => { setShowRefresh(false); notify("Demo refresh queued — no paid request sent"); }}>Confirm demo refresh</button></div></div></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
