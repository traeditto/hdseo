"use client";

import Link from "next/link";
import type { PortalRole } from "@/lib/auth/portal-types";

const portalCopy = {
  admin: { number:"01", eyebrow:"PLATFORM CONTROL", title:"Admin Portal", description:"Secure access for HD SEO platform administrators.", accent:"Platform oversight, agency controls, system health, and security operations." },
  agency: { number:"02", eyebrow:"SEO OPERATIONS", title:"Agency Portal", description:"Sign in to operate your agency and client portfolio.", accent:"Prioritize opportunities, manage clients, approve work, and measure ranking outcomes." },
  client: { number:"03", eyebrow:"CLIENT RESULTS", title:"Client Portal", description:"Your private view of SEO performance and approvals.", accent:"See progress, review recommendations, approve work, and access reports without agency complexity." },
} as const;

export function PortalLogin({portal}:{portal:PortalRole}){
  const copy=portalCopy[portal];
  return <main className={`portal-login-page portal-login-${portal}`}>
    <section className="portal-login-story"><Link className="login-brand" href="/"><span className="login-mark"><i/><b/></span><span>HD <em>SEO</em></span></Link><div><span className="story-number">{copy.number}</span><small>{copy.eyebrow}</small><h1>{copy.title}</h1><p>{copy.accent}</p></div><blockquote>“One clear system for turning search intelligence into accountable business growth.”</blockquote>
    </section>
    <section className="portal-login-form"><div className="login-form-wrap"><Link className="back-link" href="/">← All portals</Link><span className="form-eyebrow">{copy.eyebrow}</span><h2>Sign in to {copy.title}</h2><p>{copy.description}</p>
      <div className="live-login-note"><strong>Live production access</strong><p>HD SEO uses your secure ChatGPT identity. Your workspace records are saved in the production database and protected by server-side roles.</p></div>
      <Link className="login-submit live-login-button" href={`/portal/${portal}`}>Continue with ChatGPT <span>→</span></Link>
      <small className="login-security">No demo account or shared password. Access is attributed to your verified identity.</small>
    </div></section>
  </main>;
}
