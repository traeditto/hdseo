import Link from "next/link";

const portals = [
  { key: "admin", number: "01", title: "Admin", eyebrow: "PLATFORM CONTROL", description: "Manage agencies, system health, access, integrations, and platform-wide operations.", features: ["Agency management", "Platform monitoring", "Security & billing"] },
  { key: "agency", number: "02", title: "Agency", eyebrow: "SEO OPERATIONS", description: "Run your client portfolio, approve work, execute campaigns, and measure outcomes.", features: ["Client command center", "Opportunity engine", "Team workflows"] },
  { key: "client", number: "03", title: "Client", eyebrow: "CLIENT RESULTS", description: "Review rankings, approve recommended work, and see clear progress for your business.", features: ["Results dashboard", "Approvals & reports", "Live SEO progress"] },
] as const;

export default function Home() {
  return <main className="login-hub">
    <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
    <header className="login-header"><Link className="login-brand" href="/" aria-label="HD SEO home"><span className="login-mark"><i /><b /></span><span>HD <em>SEO</em></span></Link><span className="secure-entry">SECURE PORTAL ACCESS</span></header>
    <section className="login-intro"><span className="login-kicker">ONE OPERATING SYSTEM · THREE PURPOSE-BUILT WORKSPACES</span><h1>Welcome to the<br /><em>HD SEO platform.</em></h1><p>Select your workspace to securely access the tools, data, and decisions assigned to your role.</p></section>
    <section className="portal-grid" aria-label="Choose a login portal">
      {portals.map((portal) => <Link className={`portal-card portal-${portal.key}`} href={`/login/${portal.key}`} key={portal.key}>
        <div className="portal-card-top"><span>{portal.number}</span><i>↗</i></div><small>{portal.eyebrow}</small><h2>{portal.title}<br />Portal</h2><p>{portal.description}</p><ul>{portal.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}</ul><strong>Continue to {portal.title} login <b>→</b></strong>
      </Link>)}
    </section>
    <footer className="login-footer"><span>© 2026 HD SEO</span><span>Role-based access · Encrypted sessions · Audit protected</span><Link href="mailto:support@hdseo.local">Need access?</Link></footer>
  </main>;
}
