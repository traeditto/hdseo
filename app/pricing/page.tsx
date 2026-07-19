import type { Metadata } from "next";
import PricingExperience from "./pricing-experience";
import { pricingPlans } from "../pricing-catalog";
import "./pricing.css";

export const metadata: Metadata = {
  title: "HD SEO Pricing — Business and Agency Plans",
  description: "Compare HD SEO plans for approval-controlled SEO implementation, validation, and outcome reporting. Business plans start at $199/month.",
  alternates: { canonical: "/pricing" },
  openGraph: { title: "HD SEO Pricing", description: "SEO software that discovers, prepares, validates, and measures approved work. Plans start at $199/month.", url: "/pricing", type: "website" },
};

const productData = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "HD SEO",
  description: "An approval-controlled SEO operating system for discovering, implementing, validating, and measuring SEO work.",
  offers: pricingPlans.map(plan => ({ "@type": "Offer", name: `${plan.name} monthly`, price: plan.monthly, priceCurrency: "USD", url: `/pricing#${plan.slug}`, category: plan.audience })),
};

export default function PricingPage() {
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productData).replace(/</g, "\\u003c") }} /><PricingExperience /></>;
}
