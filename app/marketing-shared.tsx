import Link from "next/link";
import MarketingAnalytics from "./marketing-analytics";
import "./marketing.css";

export function MarketingLogo() {
  return <span className="m-logo"><span className="m-logo-mark" aria-hidden="true"><i /><b /></span><span>HD <em>SEO</em></span></span>;
}

const navLinks = [
  ["How It Works", "/#how-it-works"],
  ["Product", "/#product"],
  ["Plans", "/#plans"],
  ["Agencies", "/agencies"],
  ["Enterprise", "/enterprise"],
] as const;

export function MarketingHeader() {
  return <><MarketingAnalytics /><header className="m-header"><Link href="/" aria-label="HD SEO home"><MarketingLogo /></Link><nav aria-label="Primary navigation">{navLinks.map(([label, href]) => <Link key={href} href={href} data-analytics-event={label === "Agencies" ? "agency_cta_click" : label === "Enterprise" ? "enterprise_cta_click" : undefined} data-analytics-placement="header">{label}</Link>)}<Link href="/login/client">Sign In</Link></nav><Link className="m-header-cta" href="/audit" data-analytics-event="primary_audit_cta_click" data-analytics-placement="header">Get My Free Audit <span aria-hidden="true">↗</span></Link><details className="m-mobile-menu"><summary aria-label="Open navigation">Menu</summary><div>{navLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}<Link href="/login/client">Sign In</Link><Link href="/audit">Get My Free Audit</Link></div></details></header></>;
}

export function MarketingFooter() {
  return <footer className="m-footer"><div><MarketingLogo /><p>Find the right SEO improvement. Approve the work. Measure what happened.</p><span className="pilot-chip">Limited pilot program</span></div><nav aria-label="Footer navigation"><section><strong>PRODUCT</strong><Link href="/#how-it-works">How it works</Link><Link href="/#plans">Plans</Link><Link href="/audit">Free 25-page audit</Link><Link href="/book-demo" data-analytics-event="booking_cta_click" data-analytics-placement="footer">Book a walkthrough</Link></section><section><strong>FOR TEAMS</strong><Link href="/agencies" data-analytics-event="agency_cta_click" data-analytics-placement="footer">Agencies</Link><Link href="/enterprise" data-analytics-event="enterprise_cta_click" data-analytics-placement="footer">Enterprise</Link><Link href="/login/client">Sign in</Link></section><section><strong>COMPANY</strong><Link href="/book-demo">Contact</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></section></nav><div className="m-footer-bottom"><span>© 2026 HD SEO</span><span>Pilot availability and customer proof require verification before public launch.</span></div></footer>;
}

export function Arrow() { return <span aria-hidden="true">↗</span>; }

export function InfoPage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: React.ReactNode }) {
  return <main className="marketing-site info-site"><MarketingHeader /><article className="info-hero"><span className="m-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{intro}</p></article><article className="info-body">{children}</article><MarketingFooter /></main>;
}
