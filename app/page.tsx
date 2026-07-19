import MarketingHome from "./marketing-home";
import "./marketing.css";

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "HD SEO",
    url: "/",
    description: "A controlled SEO system that finds the highest-value improvement, prepares approved work, and measures the result.",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "HD SEO",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: "HD SEO checks a website and local market, recommends the best next move, prepares approved work, and measures the result.",
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
      ["What do I get in the free audit?", "A crawl of up to 25 public pages, a technical readiness summary, prioritized findings, and a plain-language next step. No credit card is required."],
      ["Will HD SEO publish without asking me?", "No. Publishing follows the permissions and approval rules configured for the workspace."],
      ["Does HD SEO guarantee rankings or revenue?", "No. HD SEO records completed work and keeps estimates separate from measured and verified outcomes."],
      ["Is HD SEO generally available?", "Not yet. HD SEO is operating as a limited pilot while production readiness and customer proof are verified."],
    ].map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })),
  },
];

function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export default function Home() {
  return <><JsonLd data={structuredData} /><MarketingHome /></>;
}
