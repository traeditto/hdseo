import { describe, expect, it } from "vitest";
import {
  evaluateSeoInvestment,
  investmentPolicyForPlan,
} from "../lib/seo/investment-policy";

describe("SEO investment policy", () => {
  const autopilot = investmentPolicyForPlan("pro");

  it("rejects the historical seven-dollar move as non-investable", () => {
    const decision = evaluateSeoInvestment(
      {
        expectedMonthlyProfit: 7.21,
        implementationCost: 350,
        paybackMonths: 48.55,
        confidenceScore: 80,
        economicsConfidence: 0.8,
        currentRank: 74,
        actionType: "IMPROVE",
        opportunityScore: 54,
      },
      autopilot,
    );

    expect(decision.qualified).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "VALUE_BELOW_PLAN_THRESHOLD",
        "PAYBACK_EXCEEDS_FOCUS_LIMIT",
        "RANKING_DISTANCE_EXCEEDS_FOCUS_RANGE",
      ]),
    );
  });

  it("accepts an attainable move with material plan-relative profit", () => {
    const decision = evaluateSeoInvestment(
      {
        expectedMonthlyProfit: 500,
        implementationCost: 350,
        paybackMonths: 0.7,
        confidenceScore: 82,
        economicsConfidence: 0.6,
        currentRank: 14,
        actionType: "IMPROVE",
        opportunityScore: 76,
      },
      autopilot,
    );

    expect(decision.qualified).toBe(true);
    expect(decision.twelveMonthRoiPercent).toBeGreaterThan(1_000);
  });

  it("uses the standard plan price to protect long-term customer value", () => {
    expect(autopilot.monthlyPlanPrice).toBe(999);
    expect(autopilot.minimumMonthlyProfit).toBe(333);
    expect(autopilot.maximumPaybackMonths).toBe(6);
  });
});
