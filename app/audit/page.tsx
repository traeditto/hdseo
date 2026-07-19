import type { Metadata } from "next";
import AuditExperience from "./audit-experience";
import "./audit.css";

export const metadata: Metadata = {
  title: "Free 25-Page SEO Audit for Local Businesses | HD SEO",
  description: "Get a focused crawl of up to 25 public website pages, prioritized findings, and a plain-language next step. No credit card required.",
  alternates: { canonical: "/audit" },
  openGraph: {
    title: "Get Your Free 25-Page SEO Audit",
    description: "A focused website check for local service businesses, with prioritized findings and no credit card required.",
    url: "/audit",
    type: "website",
    images: [{ url: "/og.png", width: 1774, height: 887, alt: "HD SEO free 25-page website audit" }],
  },
  twitter: { card: "summary_large_image", title: "Get Your Free 25-Page SEO Audit", description: "Prioritized website findings for local service businesses. No credit card required.", images: ["/og.png"] },
};

export default function AuditPage() { return <AuditExperience />; }
