import { describe, expect, it } from "vitest";
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
});
