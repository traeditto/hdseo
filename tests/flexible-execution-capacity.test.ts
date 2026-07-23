import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  availableExecutionCapacity,
  executionCapacityForOpportunity,
} from "../lib/agent-service/execution-capacity";

describe("flexible execution capacity", () => {
  it("lets a strategic focus campaign use the full monthly allocation", () => {
    expect(
      executionCapacityForOpportunity({
        actionType: "BUILD",
        evidence: { focusCampaign: { active: true } },
        recommendedActions: ["page", "links", "schema", "proof"],
        monthlyCapacity: 6,
      }),
    ).toBe(6);
  });

  it("weights smaller and larger improvements differently", () => {
    expect(
      executionCapacityForOpportunity({
        actionType: "LINK",
        monthlyCapacity: 6,
      }),
    ).toBe(1);
    expect(
      executionCapacityForOpportunity({
        actionType: "BUILD",
        recommendedActions: ["page", "links", "schema", "proof"],
        monthlyCapacity: 6,
      }),
    ).toBe(5);
  });

  it("combines remaining included and prepaid capacity", () => {
    expect(
      availableExecutionCapacity({
        monthlyCapacity: 6,
        usedCapacity: 5,
        prepaidCapacity: 2,
      }),
    ).toBe(3);
  });

  it("installs an atomic weighted reservation and exact release ledger", () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/0050_flexible_execution_capacity.sql",
      ),
      "utf8",
    );
    for (const safeguard of [
      "start_outcome_loop_run_v2",
      "p_capacity_units",
      "included_units+prepaid_units=quantity",
      "actions_used=actions_used+p_capacity_units",
      "greatest(0,actions_used-b.quantity)",
      "'agent_action',b.quantity,'execution_capacity_unit'",
      "commit_verified_recovered_outcome",
      "Never partially charge a recovered campaign",
    ]) {
      expect(sql).toContain(safeguard);
    }
  });
});
