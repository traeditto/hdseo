import { describe, expect, it } from "vitest";
import {
  selectManagedOpportunity,
  type ManagedOpportunityCandidate,
} from "../lib/agent-service/opportunity-selection";

function candidate(
  overrides: Partial<ManagedOpportunityCandidate> = {},
): ManagedOpportunityCandidate {
  return {
    id: "qualified-local-opportunity",
    opportunity_score: 72,
    confidence_score: 80,
    action_type: "IMPROVE",
    target_url: "https://example.com/roof-repair",
    reason_codes: ["LOCAL_RELEVANCE", "COMMERCIAL_INTENT"],
    evidence: {
      businessValue: {
        expectedMonthlyProfit: 600,
        implementationCost: 350,
        paybackMonths: 2,
      },
      currentRank: 12,
      economicsConfidence: 0.8,
      missingEvidence: [],
    },
    status: "open",
    cooldown_until: null,
    ...overrides,
  };
}

describe("managed Autopilot opportunity selection", () => {
  it("rejects an attractive-looking opportunity when no verified page exists", () => {
    expect(
      selectManagedOpportunity(
        [candidate({ target_url: null, opportunity_score: 99 })],
        "service_area",
      ),
    ).toBeNull();
  });

  it("rejects broad, redundant, or geographically unverified work", () => {
    expect(
      selectManagedOpportunity(
        [
          candidate({
            id: "generic",
            reason_codes: ["REDUNDANT_QUERY", "COMMERCIAL_INTENT"],
          }),
          candidate({
            id: "not-local",
            reason_codes: ["COMMERCIAL_INTENT"],
          }),
        ],
        "service_area",
      ),
    ).toBeNull();
  });

  it("selects the strongest executable local opportunity", () => {
    const selected = selectManagedOpportunity(
      [
        candidate({ id: "lower", opportunity_score: 60 }),
        candidate({ id: "higher", opportunity_score: 74 }),
      ],
      "service_area",
    );

    expect(selected?.id).toBe("higher");
  });

  it("concentrates effort on the stronger qualified business outcome", () => {
    const selected = selectManagedOpportunity(
      [
        candidate({
          id: "seo-score-only",
          opportunity_score: 92,
          evidence: {
            businessValue: {
              expectedMonthlyProfit: 350,
              implementationCost: 350,
              paybackMonths: 1,
            },
            currentRank: 12,
            economicsConfidence: 0.8,
            missingEvidence: [],
          },
        }),
        candidate({
          id: "stronger-roi",
          opportunity_score: 72,
          evidence: {
            businessValue: {
              expectedMonthlyProfit: 900,
              implementationCost: 350,
              paybackMonths: 0.39,
            },
            currentRank: 15,
            economicsConfidence: 0.8,
            missingEvidence: [],
          },
        }),
      ],
      "service_area",
    );

    expect(selected?.id).toBe("stronger-roi");
  });

  it("permits verified nationwide work without a local relevance marker", () => {
    const selected = selectManagedOpportunity(
      [candidate({ id: "national", reason_codes: ["COMMERCIAL_INTENT"] })],
      "nationwide",
    );

    expect(selected?.id).toBe("national");
  });
});
