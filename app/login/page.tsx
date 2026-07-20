import type { Metadata } from "next";
import Link from "next/link";

import { portalRoles } from "@/app/ui/portal-role-selector";

export const metadata: Metadata = {
  title: "Sign in | HD SEO",
  description: "Choose the HD SEO portal for your account.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <main className="login-hub">
    <span className="login-orbit orbit-one" aria-hidden="true" />
    <span className="login-orbit orbit-two" aria-hidden="true" />
    <header className="login-header">
      <Link className="login-brand" href="/" aria-label="HD SEO home"><span className="login-mark"><i /><b /></span><span>HD <em>SEO</em></span></Link>
      <span className="secure-entry">SECURE ROLE-BASED ENTRY</span>
    </header>
    <section className="login-intro">
      <span className="login-kicker">CHOOSE YOUR WORKSPACE</span>
      <h1>Three portals. <em>One SEO operating system.</em></h1>
      <p>Select how you use HD SEO. Your account permissions are verified before access is granted, so each person enters only the workspace authorized for their role.</p>
    </section>
    <nav className="portal-grid" aria-label="HD SEO sign-in portals">
      {portalRoles.map((item) => <Link className={`portal-card portal-${item.role}`} href={`/login/${item.role}`} key={item.role}>
        <span className="portal-card-top"><span>{item.number}</span><i aria-hidden="true">↗</i></span>
        <small>{item.eyebrow}</small>
        <h2>{item.cardTitle}</h2>
        <p>{item.description}</p>
        <ul>{item.features.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
        <strong>Sign in as {item.title}<b aria-hidden="true">→</b></strong>
      </Link>)}
    </nav>
    <footer className="login-footer"><span>© 2026 HD SEO</span><span>Encrypted sessions · Role-based access</span><Link href="/">Back to website</Link></footer>
  </main>;
}
