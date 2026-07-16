import { describe, expect, it } from "vitest";
import { discoverSearchConsoleCandidates } from "../lib/seo/search-console-discovery";
import { classifySite } from "../lib/seo/site-classifier";
import { buildWorkflowPlan } from "../lib/seo/workflow-registry";
import { compareSeoDrift, type SeoDeploymentSnapshot } from "../lib/seo/drift";

describe("autonomous SEO orchestration", () => {
  it("derives keyword candidates from first-party Search Console evidence", () => {
    const candidates = discoverSearchConsoleCandidates([
      { query: "roof repair jacksonville", page_url: "https://example.com/roof-repair", clicks: 12, impressions: 800, ctr: 0.015, average_position: 7.2 },
      { query: "roof repair jacksonville", page_url: "https://example.com/roof-repair", clicks: 4, impressions: 200, ctr: 0.02, average_position: 6.8 },
      { query: "history of roof tiles", page_url: "https://example.com/blog/tiles", clicks: 1, impressions: 20, ctr: 0.05, average_position: 42 },
    ]);
    expect(candidates[0].keyword).toBe("roof repair jacksonville");
    expect(candidates[0].impressions).toBe(1000);
    expect(candidates[0].averagePosition).toBe(7.12);
    expect(candidates[0].rankingUrl).toBe("https://example.com/roof-repair");
    expect(candidates[0]).not.toHaveProperty("searchVolume");
  });

  it("classifies local signals and routes conditional workflows", () => {
    const classification = classifySite({
      industry: "roofing contractor",
      countryCode: "US",
      languageCode: "en",
      serviceCount: 5,
      locationCount: 3,
      pages: [{ url: "https://example.com/service-areas/jacksonville", schemaTypes: ["LocalBusiness"] }],
    });
    expect(classification.primaryType).toBe("local_service");
    const plan = buildWorkflowPlan({ classification, pageCount: 12, keywordCount: 20, hasSearchConsole: true, hasDataForSeo: false, hasBaseline: true });
    expect(plan.find((item) => item.id === "local")?.status).toBe("ready");
    expect(plan.find((item) => item.id === "maps")?.status).toBe("setup_required");
    expect(plan.find((item) => item.id === "cluster")?.status).toBe("setup_required");
    expect(plan.find((item) => item.id === "drift")?.status).toBe("ready");
  });

  it("fails deployment drift when canonical or indexability regresses", () => {
    const baseline: SeoDeploymentSnapshot = { title: "Roof Repair", description: "Trusted roofing", canonical: "https://example.com/roof-repair", h1Text: "Roof Repair", h1Count: 1, metaRobots: "index,follow", schemaTypes: ["LocalBusiness"], performanceScore: 88 };
    const current: SeoDeploymentSnapshot = { ...baseline, canonical: "https://example.com/", metaRobots: "noindex,nofollow", schemaTypes: [] };
    const result = compareSeoDrift(baseline, current);
    expect(result.status).toBe("failed");
    expect(result.required).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["canonical_changed", "noindex_added", "schema_types_removed"]));
  });

  it("skips drift safely for the first healthy deployment", () => {
    const current: SeoDeploymentSnapshot = { title: "Home", description: null, canonical: "https://example.com", h1Text: "Home", h1Count: 1, metaRobots: null, schemaTypes: [], performanceScore: null };
    expect(compareSeoDrift(null, current).status).toBe("skipped");
  });
});
