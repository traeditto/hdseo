import MarketingHome from "./marketing-home";
import "./marketing.css";

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "HD SEO",
    url: "/",
    description: "An agent-first SEO operating system for accountable, evidence-led execution.",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "HD SEO",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: "HD SEO discovers, prioritizes, prepares, publishes, validates, and measures approved SEO work.",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "HD SEO",
    url: "/",
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      ["Does HD SEO publish changes automatically?", "Only within the permissions, risk rules, budgets, and approval policies you configure. High-risk work remains approval-gated."],
      ["Is HD SEO only for SEO experts?", "No. Business owners get a simple recommendation-and-approval experience, while agencies and enterprise teams can use deeper governance and reporting controls."],
      ["How does HD SEO measure return?", "It keeps estimates separate from measured performance and confirmed business outcomes, including qualified leads, recorded revenue, gross profit, and actual SEO spend."],
      ["Which websites can HD SEO work with?", "HD SEO supports controlled workflows for GitHub and Vercel, WordPress, Shopify, Webflow, guided implementation, developer handoff, and monitoring-only setups."],
    ].map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })),
  },
];

function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export default function Home() {
  return <><JsonLd data={structuredData} /><MarketingHome /></>;
}
