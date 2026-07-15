import { describe, expect, it } from "vitest";
import { discoverKeywordCandidates } from "../lib/seo/keyword-discovery";
import { scoreOpportunity } from "../lib/seo/opportunity-engine";

describe("opportunity engine", () => {
  it("prioritizes a commercially valuable rank #6 over a distant rank #38", () => {
    const near = scoreOpportunity({ currentRank: 6, previousRank: 7, searchVolume: 1100, cpc: 38, commercialIntentScore: 95, serviceRelevance: 90, locationRelevance: 90, competitorGap: 80, technicalReadiness: 85, hasOwnerPage: true, internalLinkCount: 5 });
    const distant = scoreOpportunity({ currentRank: 38, previousRank: 39, searchVolume: 4000, cpc: 12, commercialIntentScore: 45, serviceRelevance: 75, locationRelevance: 75, competitorGap: 50, technicalReadiness: 85, hasOwnerPage: true, internalLinkCount: 5 });
    expect(near.opportunityScore).toBeGreaterThan(distant.opportunityScore);
    expect(near.targetMilestone).toBe("Top 3");
  });

  it("reduces confidence and exposes missing evidence", () => {
    const result = scoreOpportunity({ currentRank: 8, hasOwnerPage: true });
    expect(result.confidenceScore).toBeLessThan(80);
    expect(result.missingEvidence).toContain("Internal-link crawl incomplete");
  });

  it("classifies missing owner pages as BUILD", () => {
    expect(scoreOpportunity({ currentRank: 24, hasOwnerPage: false }).actionType).toBe("BUILD");
  });

  it("discovers and ranks budget-aware keywords from domain data without seed keywords", () => {
    const results = [{ items: [
      { keyword_data: { keyword: "roof repair jacksonville", keyword_info: { search_volume: 1100, cpc: 38 }, keyword_properties: { keyword_difficulty: 32 }, search_intent_info: { main_intent: "commercial" } }, ranked_serp_element: { serp_item: { rank_absolute: 7, url: "https://example.com/roof-repair" } } },
      { keyword_data: { keyword: "history of roof tiles", keyword_info: { search_volume: 90, cpc: 1 }, keyword_properties: { keyword_difficulty: 80 }, search_intent_info: { main_intent: "informational" } }, ranked_serp_element: { serp_item: { rank_absolute: 54, url: "https://example.com/blog/tiles" } } },
    ] }];
    const candidates = discoverKeywordCandidates(results, 1500, 10);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].keyword).toBe("roof repair jacksonville");
    expect(candidates[0].estimatedMonthlyValue).toBeGreaterThan(0);
    expect(candidates[0].valuePerDollar).toBeGreaterThan(candidates[1].valuePerDollar);
  });

  it("finds untapped site-relevant keywords when the domain has no current ranking", () => {
    const results = [{ items: [{ keyword: "emergency roof replacement", keyword_info: { search_volume: 320, cpc: 24 }, keyword_properties: { keyword_difficulty: 28 }, search_intent_info: { main_intent: "transactional" } }] }];
    const [candidate] = discoverKeywordCandidates(results, 2000, 10);
    expect(candidate.currentRank).toBeNull();
    expect(candidate.actionType).toBe("BUILD");
    expect(candidate.opportunityScore).toBeGreaterThan(0);
  });
});
