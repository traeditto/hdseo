import type { Metadata } from "next";
import PricingExperience from "./pricing-experience";
import { agentServicePlans, pricingPlans } from "../pricing-catalog";
import "./pricing.css";

export const metadata: Metadata = {
  title: "HD SEO Pricing — Platform and Agent Service Plans",
  description: "Choose HD SEO platform plans or an approval-controlled agent service. HD SEO Autopilot and white-label agent teams research, implement, validate, and monitor approved SEO work.",
  alternates: { canonical: "/pricing" },
  openGraph: { title: "HD SEO Pricing — Guide Me or Run It for Me", description: "Choose the HD SEO platform or an approval-controlled agent team for business and agency SEO delivery.", url: "/pricing", type: "website" },
};

const productData = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "HD SEO",
  description: "An approval-controlled SEO operating system for discovering, implementing, validating, and measuring SEO work.",
  offers: [...pricingPlans, ...agentServicePlans].map(plan => ({ "@type": "Offer", name: `${plan.name} monthly`, price: plan.monthly, priceCurrency: "USD", url: `/pricing#${plan.slug}`, category: plan.audience })),
};

export default function PricingPage() {
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productData).replace(/</g, "\\u003c") }} /><PricingExperience /></>;
}
