"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";

type NavItem = { label: string; glyph: string; count?: number };
type Client = { name: string; initials: string; color: string; project: string; health: number; status: string; action: string; score: number; tasks: number; trend: string; refresh: string };
type QueueItem = { title: string; client: string; meta: string; priority: string; due: string; action: string; status: string };
type ModalState = { kind: string; title: string; description: string; subject?: string } | null;

const navigation: { label?: string; items: NavItem[] }[] = [
  { items: [{ label: "Command center", glyph: "⌂" }, { label: "Next best actions", glyph: "↗", count: 18 }, { label: "Clients", glyph: "◇" }, { label: "Work queue", glyph: "✓", count: 7 }] },
  { label: "INTELLIGENCE", items: [{ label: "Rankings", glyph: "⌁" }, { label: "Site audits", glyph: "◎" }, { label: "Competitors", glyph: "◫" }, { label: "Reports", glyph: "▤" }] },
  { label: "OPERATIONS", items: [{ label: "Executions", glyph: "⌘" }, { label: "Approvals", glyph: "◉", count: 4 }, { label: "Team", glyph: "♙" }, { label: "Integrations", glyph: "⇄" }] },
];

const metrics = [
  { label: "ACTIVE CLIENTS", value: "12", detail: "2 onboarding", trend: "+2", tone: "positive" },
  { label: "OPEN OPPORTUNITIES", value: "47", detail: "8 high priority", trend: "+8", tone: "positive" },
  { label: "AWAITING APPROVAL", value: "4", detail: "Oldest: 3 days", trend: "Review", tone: "warning" },
  { label: "RANKING WINS", value: "23", detail: "Past 30 days", trend: "+14%", tone: "positive" },
];

const initialClients: Client[] = [
  { name: "Kingdom Roofing", initials: "KR", color: "clay", project: "Main Website", health: 86, status: "Strong", action: "Improve ‘roof repair Jacksonville’", score: 94, tasks: 3, trend: "+12", refresh: "18 min ago" },
  { name: "Northwind HVAC", initials: "NH", color: "blue", project: "NorthwindComfort.com", health: 72, status: "Healthy", action: "Build ‘AC repair Ponte Vedra’", score: 87, tasks: 5, trend: "+6", refresh: "2 hours ago" },
  { name: "Coastal Plumbing", initials: "CP", color: "teal", project: "CoastalPlumbingFL.com", health: 61, status: "Attention", action: "Defend ‘emergency plumber’", score: 83, tasks: 4, trend: "−4", refresh: "5 hours ago" },
  { name: "Canopy Tree Care", initials: "CT", color: "gold", project: "CanopyTreeExperts.com", health: 78, status: "Healthy", action: "Fix duplicate location pages", score: 79, tasks: 2, trend: "+8", refresh: "Yesterday" },
];

const initialQueue: QueueItem[] = [
  { title: "Review roof repair execution draft", client: "Kingdom Roofing", meta: "Content · Assigned to Maya Chen", priority: "HIGH", due: "Today", action: "Review", status: "Awaiting review" },
  { title: "Approve HVAC service-page changes", client: "Northwind HVAC", meta: "Approval · Assigned to you", priority: "HIGH", due: "Today", action: "Approve", status: "Awaiting approval" },
  { title: "Investigate Maps visibility decline", client: "Coastal Plumbing", meta: "Maps · Assigned to Jordan Lee", priority: "MED", due: "Tomorrow", action: "Open", status: "In progress" },
];

const opportunities = [
  { score: 94, client: "Kingdom Roofing", action: "Improve Roof Repair Jacksonville", type: "IMPROVE", rank: "#6", target: "Top 3", value: "$38.40 CPC" },
  { score: 87, client: "Northwind HVAC", action: "Build AC Repair Ponte Vedra", type: "BUILD", rank: "#18", target: "Top 10", value: "$31.10 CPC" },
  { score: 83, client: "Coastal Plumbing", action: "Defend Emergency Plumber", type: "DEFEND", rank: "#4 → #8", target: "Top 5", value: "$44.70 CPC" },
  { score: 79, client: "Canopy Tree Care", action: "Resolve duplicate location pages", type: "TECHNICAL", rank: "#12", target: "Top 10", value: "High intent" },
];

const rankings = [
  { keyword: "roof repair jacksonville", client: "Kingdom Roofing", rank: 6, change: "+3", volume: "1,100", url: "/roof-repair-jacksonville" },
  { keyword: "emergency plumber", client: "Coastal Plumbing", rank: 8, change: "−4", volume: "880", url: "/emergency-plumber" },
  { keyword: "ac repair ponte vedra", client: "Northwind HVAC", rank: 18, change: "+7", volume: "720", url: "/service-areas/ponte-vedra" },
  { keyword: "tree removal jacksonville", client: "Canopy Tree Care", rank: 5, change: "+2", volume: "590", url: "/tree-removal" },
];

const views: Record<string, { eyebrow: string; title: string; description: string }> = {
  "Next best actions": { eyebrow: "OPPORTUNITY ENGINE", title: "Next best actions", description: "Evidence-backed opportunities ranked by value, confidence, and realistic milestone." },
  Clients: { eyebrow: "PORTFOLIO", title: "Clients", description: "Manage organizations, SEO projects, health, access, and delivery status." },
  "Work queue": { eyebrow: "AGENCY OPERATIONS", title: "Work queue", description: "Assigned, approved, and scheduled SEO work across the agency." },
  Rankings: { eyebrow: "ORGANIC VISIBILITY", title: "Rankings", description: "Current positions, movement, milestones, and ranking URLs." },
  "Site audits": { eyebrow: "TECHNICAL SEO", title: "Site audits", description: "Prioritized crawl findings with evidence, ownership, and resolution status." },
  Competitors: { eyebrow: "MARKET INTELLIGENCE", title: "Competitors", description: "Domains and pages competing for each client’s highest-value searches." },
  Reports: { eyebrow: "CLIENT COMMUNICATION", title: "Reports", description: "White-label live and scheduled reports with ranking movement since implementation." },
  Executions: { eyebrow: "IMPLEMENTATION", title: "Executions", description: "Review, validate, and monitor approved repository or instruction-mode changes." },
  Approvals: { eyebrow: "HUMAN REVIEW", title: "Approvals", description: "Agency and client decisions waiting for an accountable reviewer." },
  Team: { eyebrow: "ACCESS CONTROL", title: "Team", description: "Agency members, roles, invitations, and workload ownership." },
  Integrations: { eyebrow: "CONNECTIONS", title: "Integrations", description: "Secure provider, analytics, repository, billing, and notification connections." },
};

function BrandMark({ small = false }: { small?: boolean }) { return <span className={small ? "brand-mark small" : "brand-mark"} aria-hidden="true"><i /><b /></span>; }

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label>; }

export function AgencyDashboard() {
  const [active, setActive] = useState("Command center");
  const [clientFilter, setClientFilter] = useState("All clients");
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [clients, setClients] = useState(initialClients);
  const [queue, setQueue] = useState(initialQueue);
  const [searchTerm, setSearchTerm] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("All priorities");
  const [notifications, setNotifications] = useState(4);

  const filteredClients = useMemo(() => clientFilter === "All clients" ? clients : clients.filter((client) => client.name === clientFilter), [clientFilter, clients]);
  const filteredQueue = useMemo(() => priorityFilter === "All priorities" ? queue : queue.filter((item) => item.priority === priorityFilter), [priorityFilter, queue]);
  const currentView = views[active];

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(null), 2800); }
  function open(kind: string, title: string, description: string, subject?: string) { setModal({ kind, title, description, subject }); }
  function go(view: string) { setActive(view); setMobileNav(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function finish(message: string) { setModal(null); notify(message); }

  function addClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("clientName") || "New client");
    const domain = String(data.get("domain") || "Website project");
    const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    setClients((current) => [...current, { name, initials, color: "teal", project: domain, health: 50, status: "Onboarding", action: "Complete initial data collection", score: 65, tasks: 1, trend: "—", refresh: "Not synced" }]);
    finish(`${name} added to onboarding`);
  }

  function completeQueueItem(title: string, verb: string) {
    setQueue((current) => current.map((item) => item.title === title ? { ...item, status: verb === "Approve" ? "Approved" : "Completed", action: "View" } : item));
    finish(`${title} ${verb === "Approve" ? "approved" : "updated"}`);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand"><BrandMark /><span>HD <em>SEO</em></span><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation">×</button></div>
        <button className="workspace-switcher" onClick={() => open("workspace", "Switch workspace", "Choose the agency workspace you want to operate.")}>
          <span className="workspace-avatar">HD</span><span className="workspace-copy"><small>WORKSPACE</small><strong>HD SEO Agency</strong></span><b>⌄</b>
        </button>
        <nav aria-label="Primary navigation">{navigation.map((group, index) => <div className="nav-group" key={index}>{group.label && <div className="nav-label">{group.label}</div>}{group.items.map((item) => <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => go(item.label)}><span className="nav-glyph">{item.glyph}</span><span>{item.label}</span>{item.count && <small>{item.count}</small>}</button>)}</div>)}</nav>
        <div className="sidebar-footer">
          <button className="usage-button" onClick={() => open("usage", "Monthly data usage", "Review authorized provider operations and agency limits.")}><span className="usage-row"><span>Monthly data usage</span><strong>$84 / $150</strong></span><span className="usage-track"><i /></span><small>56% of agency allowance</small></button>
          <button className="profile-card" onClick={() => open("profile", "Account & preferences", "Manage your profile, role, timezone, and notifications.")}><span>OM</span><span><strong>Olivia Martin</strong><small>Agency owner</small></span><b>•••</b></button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button>
          <div className="breadcrumbs"><span>HD SEO Agency</span><b>/</b><strong>{active}</strong></div>
          <div className="top-actions">
            <button onClick={() => open("search", "Search HD SEO", "Find clients, keywords, opportunities, tasks, and reports.")} aria-label="Search">⌕</button>
            <button className="notification" onClick={() => open("notifications", "Notifications", "Review important agency activity and alerts.")} aria-label="Notifications">♢{notifications > 0 && <i />}</button>
            <button className="add-client" onClick={() => open("add-client", "Add a client", "Create the client organization and its first SEO project.")}>＋ Add client</button>
          </div>
        </header>

        <div className="content">
          <div className="demo-banner"><span>DEMO DATA</span><p>You’re viewing a synthetic agency workspace. No paid data operations will run.</p><button onClick={() => open("guide", "Interactive demo guide", "Follow the core workflow from client connection to ranking outcome.")}>View demo guide →</button></div>

          {active === "Command center" ? <>
            <div className="page-heading"><div><h1>Good morning, Olivia</h1><p>Here’s where your agency can create the most SEO value today.</p></div><div className="heading-actions"><label><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} aria-label="Filter by client"><option>All clients</option>{clients.map((client) => <option key={client.name}>{client.name}</option>)}</select></label><button className="refresh-button" onClick={() => open("refresh", "Authorize data refresh", "Confirm scope and estimated provider cost before collection.")}>↻ Refresh data</button></div></div>
            <section className="metrics-grid" aria-label="Agency overview">{metrics.map((metric) => <button className="metric-card" onClick={() => go(metric.label === "ACTIVE CLIENTS" ? "Clients" : metric.label === "OPEN OPPORTUNITIES" ? "Next best actions" : metric.label === "AWAITING APPROVAL" ? "Approvals" : "Rankings")} key={metric.label}><span className="metric-icon">{metric.label === "ACTIVE CLIENTS" ? "◇" : metric.label === "OPEN OPPORTUNITIES" ? "↗" : metric.label === "AWAITING APPROVAL" ? "◷" : "⌁"}</span><span className="metric-copy"><small>{metric.label}</small><strong>{metric.value}</strong><em>{metric.detail}</em></span><i className={metric.tone}>{metric.trend}</i></button>)}</section>
            <PriorityCard open={open} />
            <ClientTable clients={filteredClients} open={open} go={go} />
            <QueueSection items={filteredQueue} open={open} go={go} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} />
          </> : <ProductView active={active} view={currentView} clients={clients} queue={filteredQueue} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} open={open} go={go} />}

          <footer className="content-footer"><span><BrandMark small /> HD SEO</span><p>Last synced 18 minutes ago · All systems operational</p><button onClick={() => open("support", "Help & support", "Search documentation or send a support request.")}>? Help & support</button></footer>
        </div>
      </section>

      {modal && <WorkflowModal modal={modal} close={() => setModal(null)} finish={finish} addClient={addClient} searchTerm={searchTerm} setSearchTerm={setSearchTerm} clients={clients} notifications={notifications} clearNotifications={() => { setNotifications(0); finish("Notifications marked as read"); }} completeQueueItem={completeQueueItem} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function PriorityCard({ open }: { open: (kind: string, title: string, description: string, subject?: string) => void }) {
  return <section className="priority-card"><div className="priority-ribbon"><span>◆</span> NEXT BEST ACTION <em>HIGHEST VALUE ACROSS ALL CLIENTS</em></div><div className="priority-body"><div className="priority-main"><div className="client-kicker"><span className="client-avatar clay">KR</span><div><strong>Kingdom Roofing</strong><small>Main Website · Jacksonville, FL</small></div><em>HIGH PRIORITY</em></div><h2>Improve “Roof Repair Jacksonville”</h2><p className="priority-copy">The existing page ranks within striking distance of the Top 3 for a high-intent service query. Stronger coverage and internal-link support are likely to improve its competitive position.</p><div className="why-row"><span>WHY NOW</span><p>Position <b>#6</b> is a realistic milestone opportunity with high commercial value and a clear competitor content gap.</p></div><div className="specific-work"><span>RECOMMENDED WORK</span><div><i>1</i><p><strong>Strengthen service coverage</strong><small>Add repair types, diagnostic process, and verified service-area details.</small></p></div><div><i>2</i><p><strong>Improve internal-link support</strong><small>Add contextual links from 4 relevant service and location pages.</small></p></div><div><i>3</i><p><strong>Review metadata & schema</strong><small>Align the title, description, and Service schema to the target intent.</small></p></div></div></div><aside className="score-panel"><span>OPPORTUNITY SCORE</span><div className="score-ring"><strong>94</strong><small>/100</small></div><div className="confidence"><span>Confidence</span><strong>86%</strong><div><i /></div></div><dl><div><dt>Current rank</dt><dd>#6</dd></div><div><dt>Target milestone</dt><dd>Top 3</dd></div><div><dt>Search volume</dt><dd>1,100</dd></div><div><dt>CPC</dt><dd>$38.40</dd></div></dl><button className="primary-action" onClick={() => open("draft", "Create implementation draft", "Prepare reviewable work from the approved opportunity.", "Improve Roof Repair Jacksonville")}>Create implementation draft</button><button className="secondary-action" onClick={() => open("evidence", "Opportunity evidence", "Review every score contribution, source, and missing signal.", "Improve Roof Repair Jacksonville")}>View full evidence</button></aside></div></section>;
}

function ClientTable({ clients, open, go }: { clients: Client[]; open: (kind: string, title: string, description: string, subject?: string) => void; go: (view: string) => void }) {
  return <section className="data-section client-section"><div className="section-header"><div><h2>Client health</h2><p>Portfolio status and highest-priority work</p></div><button onClick={() => go("Clients")}>View all clients →</button></div><div className="table-wrap"><table><thead><tr><th>CLIENT</th><th>SEO HEALTH</th><th>HIGHEST-PRIORITY OPPORTUNITY</th><th>OPEN TASKS</th><th>30D TREND</th><th>LAST REFRESH</th><th /></tr></thead><tbody>{clients.map((client) => <tr key={client.name}><td><button className="table-client client-link" onClick={() => open("client", client.name, "Open the private SEO command center.", client.name)}><span className={`client-avatar ${client.color}`}>{client.initials}</span><span><strong>{client.name}</strong><small>{client.project}</small></span></button></td><td><div className="health"><strong>{client.health}</strong><span className={client.status === "Attention" ? "attention" : ""}>{client.status}</span></div></td><td><button className="opportunity-link" onClick={() => open("evidence", client.action, "Review score evidence and recommended work.", client.name)}><span>{client.action}</span><small>Score {client.score}</small></button></td><td><strong>{client.tasks}</strong></td><td><span className={client.trend.startsWith("+") ? "trend-up" : "trend-down"}>{client.trend}</span></td><td><span className="muted">{client.refresh}</span></td><td><button className="row-menu" onClick={() => open("client-actions", `${client.name} actions`, "Choose a project-level action.", client.name)} aria-label={`More actions for ${client.name}`}>•••</button></td></tr>)}</tbody></table></div></section>;
}

function QueueSection({ items, open, go, priorityFilter, setPriorityFilter }: { items: QueueItem[]; open: (kind: string, title: string, description: string, subject?: string) => void; go: (view: string) => void; priorityFilter: string; setPriorityFilter: (value: string) => void }) {
  return <section className="data-section queue-section"><div className="section-header"><div><h2>Agency work queue</h2><p>Prioritized work that needs attention</p></div><div><select className="inline-filter" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Filter work queue"><option>All priorities</option><option>HIGH</option><option>MED</option></select><button onClick={() => go("Work queue")}>View full queue →</button></div></div><div className="queue-list">{items.map((item, index) => <article key={item.title}><span className="queue-number">0{index + 1}</span><div className="queue-copy"><h3>{item.title}</h3><p><strong>{item.client}</strong><span>·</span>{item.meta} · {item.status}</p></div><span className={`priority-pill ${item.priority === "MED" ? "medium" : ""}`}>{item.priority}</span><div className="queue-due"><small>DUE</small><strong>{item.due}</strong></div><button onClick={() => open("queue-action", item.title, "Review evidence, notes, and the approval history.", item.action)}>{item.action}</button></article>)}</div></section>;
}

function ProductView({ active, view, clients, queue, priorityFilter, setPriorityFilter, open, go }: { active: string; view: { eyebrow: string; title: string; description: string }; clients: Client[]; queue: QueueItem[]; priorityFilter: string; setPriorityFilter: (value: string) => void; open: (kind: string, title: string, description: string, subject?: string) => void; go: (view: string) => void }) {
  return <><div className="view-hero"><span>{view.eyebrow}</span><h1>{view.title}</h1><p>{view.description}</p></div>{active === "Next best actions" && <div className="opportunity-grid">{opportunities.map((item) => <article className="opportunity-card" key={item.action}><div className="op-score">{item.score}</div><div><span>{item.type} · {item.client}</span><h2>{item.action}</h2><p>Current {item.rank} · Target {item.target} · {item.value}</p></div><div className="card-actions"><button onClick={() => open("evidence", item.action, "Review scoring contributions, ranking history, and competitor evidence.", item.client)}>Evidence</button><button onClick={() => open("draft", "Create implementation draft", "Prepare a human-reviewable execution brief.", item.action)}>Create draft</button></div></article>)}</div>}
    {active === "Clients" && <><div className="view-toolbar"><button className="solid-button" onClick={() => open("add-client", "Add a client", "Create the client organization and its first SEO project.")}>＋ Add client</button></div><ClientTable clients={clients} open={open} go={go} /></>}
    {active === "Work queue" && <QueueSection items={queue} open={open} go={go} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} />}
    {active === "Rankings" && <section className="data-section"><div className="section-header"><div><h2>Tracked keyword movement</h2><p>Latest stored ranking snapshots</p></div><button onClick={() => open("refresh", "Refresh rankings", "Authorize a scoped ranking collection.")}>Refresh rankings</button></div><div className="table-wrap"><table><thead><tr><th>KEYWORD</th><th>CLIENT</th><th>POSITION</th><th>CHANGE</th><th>VOLUME</th><th>RANKING URL</th><th /></tr></thead><tbody>{rankings.map((row) => <tr key={row.keyword}><td><strong>{row.keyword}</strong></td><td>{row.client}</td><td><strong>#{row.rank}</strong></td><td><span className={row.change.startsWith("+") ? "trend-up" : "trend-down"}>{row.change}</span></td><td>{row.volume}</td><td><code>{row.url}</code></td><td><button className="row-action" onClick={() => open("ranking", row.keyword, "Inspect ranking history, volatility, SERP ownership, and milestones.", row.client)}>Analyze</button></td></tr>)}</tbody></table></div></section>}
    {active === "Site audits" && <CardList items={[{ title: "Critical indexing conflict", meta: "Coastal Plumbing · 3 pages · Critical", status: "OPEN" }, { title: "Duplicate Jacksonville location pages", meta: "Canopy Tree Care · 6 pages · High", status: "OPEN" }, { title: "Weak internal-link depth", meta: "Kingdom Roofing · 14 pages · Medium", status: "PLANNED" }]} action="Review finding" kind="audit" open={open} />}
    {active === "Competitors" && <CardList items={[{ title: "roofclaim.com", meta: "Kingdom Roofing · 38 shared keywords · 11 content gaps", status: "+11 GAPS" }, { title: "firstcoastcomfort.com", meta: "Northwind HVAC · 24 shared keywords · 8 content gaps", status: "+8 GAPS" }, { title: "jaxplumbingpros.com", meta: "Coastal Plumbing · 31 shared keywords · 5 content gaps", status: "+5 GAPS" }]} action="Compare pages" kind="competitor" open={open} />}
    {active === "Reports" && <CardList items={[{ title: "Kingdom Roofing · June SEO Report", meta: "Scheduled July 15 · Client portal + email", status: "READY" }, { title: "Northwind HVAC · June SEO Report", meta: "Draft · 2 sections need review", status: "DRAFT" }, { title: "Coastal Plumbing · Recovery Brief", meta: "Live report · Updated 5 hours ago", status: "LIVE" }]} action="Open report" kind="report" open={open} secondary="Generate report" />}
    {active === "Executions" && <CardList items={[{ title: "Roof repair content improvement", meta: "Validation passed · 3 approved files · Repository", status: "READY FOR PR" }, { title: "Ponte Vedra service page", meta: "Draft · Instruction mode · Awaiting strategist", status: "REVIEW" }, { title: "Local page canonical repair", meta: "Monitoring · Implemented 14 days ago", status: "MONITORING" }]} action="Review execution" kind="execution" open={open} />}
    {active === "Approvals" && <CardList items={[{ title: "Approve HVAC service-page changes", meta: "Agency approval · Requested by Maya Chen · Due today", status: "AGENCY" }, { title: "Roof repair proof request", meta: "Client approval · Kingdom Roofing · Waiting 2 days", status: "CLIENT" }, { title: "Canonical repair execution", meta: "Technical approval · Assigned to Olivia", status: "AGENCY" }]} action="Review approval" kind="approval" open={open} />}
    {active === "Team" && <><div className="view-toolbar"><button className="solid-button" onClick={() => open("invite", "Invite team member", "Assign an agency role and send an invitation.")}>＋ Invite member</button></div><CardList items={[{ title: "Olivia Martin", meta: "Agency owner · 4 approvals assigned", status: "ACTIVE" }, { title: "Maya Chen", meta: "SEO strategist · 7 open tasks", status: "ACTIVE" }, { title: "Jordan Lee", meta: "Account manager · 4 clients", status: "ACTIVE" }, { title: "Evan Brooks", meta: "Developer · 2 executions", status: "INVITED" }]} action="Manage member" kind="member" open={open} /></>}
    {active === "Integrations" && <CardList items={[{ title: "DataForSEO", meta: "Platform-provided data · Last verified today", status: "CONNECTED" }, { title: "Google Search Console", meta: "3 of 12 projects connected", status: "PARTIAL" }, { title: "GitHub App", meta: "2 repositories connected", status: "CONNECTED" }, { title: "Stripe", meta: "Development billing mode", status: "MOCK MODE" }, { title: "Resend", meta: "Transactional email not configured", status: "SETUP" }]} action="Configure" kind="integration" open={open} />}
  </>;
}

function CardList({ items, action, kind, open, secondary }: { items: { title: string; meta: string; status: string }[]; action: string; kind: string; open: (kind: string, title: string, description: string, subject?: string) => void; secondary?: string }) {
  return <section className="record-list">{items.map((item) => <article key={item.title}><span className="record-status">{item.status}</span><div><h2>{item.title}</h2><p>{item.meta}</p></div><div className="record-actions">{secondary && <button onClick={() => open("generate-report", secondary, "Choose report period, recipients, and delivery channel.", item.title)}>{secondary}</button>}<button className="solid-button" onClick={() => open(kind, `${action}: ${item.title}`, "Review details, evidence, ownership, and activity before continuing.", item.title)}>{action}</button></div></article>)}</section>;
}

function WorkflowModal({ modal, close, finish, addClient, searchTerm, setSearchTerm, clients, notifications, clearNotifications, completeQueueItem }: { modal: NonNullable<ModalState>; close: () => void; finish: (message: string) => void; addClient: (event: FormEvent<HTMLFormElement>) => void; searchTerm: string; setSearchTerm: (value: string) => void; clients: Client[]; notifications: number; clearNotifications: () => void; completeQueueItem: (title: string, verb: string) => void }) {
  const searchResults = searchTerm ? [...clients.map((client) => `${client.name} · Client organization`), ...opportunities.map((item) => `${item.action} · Opportunity`)].filter((item) => item.toLowerCase().includes(searchTerm.toLowerCase())) : [];
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><div className="modal workflow-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close} aria-label="Close">×</button><span className="modal-kicker">HD SEO WORKFLOW</span><h2 id="modal-title">{modal.title}</h2><p>{modal.description}</p>
    {modal.kind === "add-client" && <form className="workflow-form" onSubmit={addClient}><div className="form-grid"><Field label="Client name"><input name="clientName" required placeholder="Acme Home Services" /></Field><Field label="Industry"><select name="industry"><option>Roofing</option><option>HVAC</option><option>Plumbing</option><option>Home services</option></select></Field><Field label="Primary domain"><input name="domain" required placeholder="example.com" /></Field><Field label="Primary market"><input name="market" required placeholder="Jacksonville, FL" /></Field></div><label className="check-row"><input type="checkbox" defaultChecked /> Create the first SEO project</label><div className="modal-actions"><button type="button" onClick={close}>Cancel</button><button type="submit">Create client</button></div></form>}
    {modal.kind === "search" && <div className="search-panel"><input autoFocus value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search clients, keywords, opportunities…" />{searchResults.length > 0 ? <div className="search-results">{searchResults.map((result) => <button key={result} onClick={() => finish(`${result.split(" · ")[0]} opened`)}>{result}<span>→</span></button>)}</div> : <p className="empty-note">Start typing to search the demo workspace.</p>}</div>}
    {modal.kind === "notifications" && <><div className="notification-list"><button onClick={() => finish("Approval opened")}>Approval required: HVAC service-page changes <span>2h</span></button><button onClick={() => finish("Ranking decline opened")}>Ranking decline: emergency plumber <span>5h</span></button><button onClick={() => finish("Report opened")}>Kingdom Roofing report is ready <span>1d</span></button><button onClick={() => finish("Execution opened")}>Execution validation passed <span>1d</span></button></div><div className="modal-actions"><button onClick={close}>Close</button>{notifications > 0 && <button onClick={clearNotifications}>Mark all read</button>}</div></>}
    {modal.kind === "refresh" && <><div className="cost-box"><span>Estimated scope</span><strong>12 clients · 1,248 keywords</strong><span>Estimated provider cost</span><strong>$4.80–$6.20</strong><span>Authorization</span><strong>Agency owner required</strong></div><label className="check-row"><input type="checkbox" defaultChecked /> Log this authorization and estimated cost</label><div className="modal-actions"><button onClick={close}>Cancel</button><button onClick={() => finish("Authorized demo refresh queued")}>Authorize refresh</button></div></>}
    {modal.kind === "draft" && <form className="workflow-form" onSubmit={(event) => { event.preventDefault(); finish("Implementation draft saved for review"); }}><div className="evidence-summary"><span>OPPORTUNITY</span><strong>{modal.subject}</strong><p>Score 94 · Confidence 86% · Target Top 3</p></div><Field label="Execution path"><select><option>Repository-connected change</option><option>Developer-ready instructions</option></select></Field><Field label="Assigned strategist"><select><option>Maya Chen</option><option>Olivia Martin</option></select></Field><Field label="Draft notes"><textarea defaultValue="Strengthen service coverage, add four contextual internal links, and align metadata with verified business evidence." /></Field><div className="modal-actions"><button type="button" onClick={close}>Cancel</button><button type="submit">Create draft</button></div></form>}
    {modal.kind === "evidence" && <><div className="score-breakdown"><div><span>Ranking proximity</span><strong>+23</strong></div><div><span>Commercial intent</span><strong>+20</strong></div><div><span>Search demand</span><strong>+15</strong></div><div><span>CPC value</span><strong>+11</strong></div><div><span>Competitor gap</span><strong>+10</strong></div><div><span>Local relevance</span><strong>+9</strong></div><div><span>Technical readiness</span><strong>+6</strong></div></div><div className="missing-evidence"><strong>Missing evidence</strong><p>Search Console click data unavailable. Internal-link crawl is 92% complete.</p></div><div className="modal-actions"><button onClick={close}>Close</button><button onClick={() => finish("Evidence snapshot exported")}>Export evidence</button></div></>}
    {modal.kind === "queue-action" && <><div className="activity-box"><span>STATUS</span><strong>{modal.subject === "Approve" ? "Awaiting agency approval" : "Ready for review"}</strong><p>Evidence snapshot locked · Human edits protected · Validation history available</p></div><Field label="Reviewer note"><textarea placeholder="Add an internal review note…" /></Field><div className="modal-actions"><button onClick={() => finish("Revision requested")}>Request revision</button><button onClick={() => completeQueueItem(modal.title, modal.subject || "Review")}>{modal.subject === "Approve" ? "Approve work" : "Complete review"}</button></div></>}
    {modal.kind === "approval" && <><div className="diff-preview"><div><span>BEFORE</span><p>Roof Repair in Jacksonville | Kingdom Roofing</p></div><div><span>PROPOSED</span><p>Jacksonville Roof Repair & Emergency Service | Kingdom Roofing</p></div></div><Field label="Approval note"><textarea placeholder="Optional note for the execution record…" /></Field><div className="modal-actions"><button onClick={() => finish("Changes requested")}>Request changes</button><button onClick={() => finish("Work approved and audit logged")}>Approve</button></div></>}
    {modal.kind === "workspace" && <div className="choice-list"><button className="selected" onClick={() => finish("HD SEO Agency selected")}><span>HD</span><div><strong>HD SEO Agency</strong><small>12 clients · Agency plan</small></div><b>✓</b></button><button onClick={() => finish("Demo sandbox selected")}><span>DS</span><div><strong>Demo Sandbox</strong><small>Synthetic training workspace</small></div><b>→</b></button></div>}
    {modal.kind === "guide" && <div className="guide-steps">{["Connect client", "Collect authorized data", "Score opportunities", "Approve the work", "Execute through PR or task", "Monitor ranking movement"].map((step, index) => <button key={step} onClick={() => finish(`${step} guide opened`)}><span>{index + 1}</span><strong>{step}</strong><b>→</b></button>)}</div>}
    {modal.kind === "usage" && <><div className="usage-detail"><strong>$84.20</strong><span>estimated July provider spend</span><div><i style={{ width: "56%" }} /></div></div><div className="score-breakdown"><div><span>SERP checks</span><strong>$46.80</strong></div><div><span>Keyword metrics</span><strong>$18.20</strong></div><div><span>Maps scans</span><strong>$12.40</strong></div><div><span>Site audits</span><strong>$6.80</strong></div></div><div className="modal-actions"><button onClick={close}>Close</button><button onClick={() => finish("Usage CSV prepared")}>Export usage</button></div></>}
    {modal.kind === "profile" && <form className="workflow-form" onSubmit={(event) => { event.preventDefault(); finish("Profile preferences saved"); }}><Field label="Display name"><input defaultValue="Olivia Martin" /></Field><Field label="Timezone"><select defaultValue="America/New_York"><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></Field><label className="check-row"><input type="checkbox" defaultChecked /> Email me when approval is required</label><div className="modal-actions"><button type="button" onClick={close}>Cancel</button><button type="submit">Save preferences</button></div></form>}
    {modal.kind === "support" && <form className="workflow-form" onSubmit={(event) => { event.preventDefault(); finish("Support request submitted"); }}><Field label="Topic"><select><option>Product question</option><option>Data provider</option><option>Billing</option><option>Technical issue</option></select></Field><Field label="How can we help?"><textarea required placeholder="Describe what you need…" /></Field><div className="modal-actions"><button type="button" onClick={close}>Cancel</button><button type="submit">Send request</button></div></form>}
    {modal.kind === "invite" && <form className="workflow-form" onSubmit={(event) => { event.preventDefault(); finish("Team invitation sent"); }}><Field label="Email address"><input type="email" required placeholder="teammate@agency.com" /></Field><Field label="Agency role"><select><option>SEO strategist</option><option>Content editor</option><option>Developer</option><option>Account manager</option><option>Viewer</option></select></Field><div className="modal-actions"><button type="button" onClick={close}>Cancel</button><button type="submit">Send invitation</button></div></form>}
    {!["add-client", "search", "notifications", "refresh", "draft", "evidence", "queue-action", "approval", "workspace", "guide", "usage", "profile", "support", "invite"].includes(modal.kind) && <><div className="activity-box"><span>SELECTED RECORD</span><strong>{modal.subject || modal.title}</strong><p>Activity, ownership, evidence, and status are available in this workflow.</p></div><Field label="Internal note"><textarea placeholder="Add a note to the activity timeline…" /></Field><div className="modal-actions"><button onClick={close}>Close</button><button onClick={() => finish(`${modal.subject || modal.title} updated`)}>Save & continue</button></div></>}
  </div></div>;
}
