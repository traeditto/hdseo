import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("customer-visible accountable work receipts", () => {
  it("tenant-scopes every receipt to an authorized project and exact package", () => {
    const route = read("app/api/work-receipts/route.ts");
    expect(route).toContain("requireLiveAgencyProject");
    expect(route).toContain('permission: "seo.read"');
    expect(route).toContain('.eq("agency_id", context.agencyId)');
    expect(route).toContain('.eq("client_organization_id", context.clientId)');
    expect(route).toContain('.eq("project_id", projectId)');
    expect(route).toContain('.eq("id", packageId)');
  });

  it("does not confuse approval with execution or verified delivery", () => {
    const route = read("app/api/work-receipts/route.ts");
    const receipt = read("app/ui/work-receipt.tsx");
    expect(route).toContain("const approvalRecorded");
    expect(route).toContain("const implementationStarted");
    expect(route).toContain("const published");
    expect(route).toContain("const verified");
    expect(receipt).toContain("Approved means authorized—not completed");
    expect(receipt).toContain("No execution proof exists yet");
  });

  it("shows the keyword plan, execution proof, creative readiness and cost receipt", () => {
    const route = read("app/api/work-receipts/route.ts");
    const receipt = read("app/ui/work-receipt.tsx");
    for (const source of [
      "seo_opportunities",
      "seo_keywords",
      "seo_action_drafts",
      "outcome_loop_runs",
      "outcome_loop_steps",
      "seo_executions",
      "deployments",
      "implementation_verifications",
      "proof_of_work_events",
      "seo_creative_specs",
      "business_proof_assets",
      "billable_usage_reservations",
      "project_budget_transactions",
    ]) expect(route).toContain(`from(\"${source}\")`);
    for (const heading of [
      "The keyword and exact proposed move",
      "A custom creative would help this keyword",
      "Links, checks and independent evidence",
      "What the plan covers—and what was actually spent",
    ]) expect(receipt).toContain(heading);
  });

  it("uses one receipt in both the client and agency portals", () => {
    const client = read("app/ui/live-client-dashboard.tsx");
    const agency = read("app/ui/live-agency-dashboard.tsx");
    expect(client).toContain("<WorkReceipt");
    expect(client).toContain("View work receipt");
    expect(agency).toContain("<WorkReceipt");
    expect(agency).toContain("Work receipt");
  });

  it("requires a business owner rights attestation before verifying an uploaded photo", () => {
    const route = read("app/api/creatives/proof-upload/route.ts");
    const receipt = read("app/ui/work-receipt.tsx");
    expect(route).toContain('context.actorType==="client"');
    expect(route).toContain('form.get("attestRights")');
    expect(route).toContain("verifyBusinessProof");
    expect(receipt).toContain("I own this photo or have permission to use it");
  });

  it("labels the $100 as an optional external ceiling rather than included work", () => {
    const client = read("app/ui/live-client-dashboard.tsx");
    const receipt = read("app/ui/work-receipt.tsx");
    expect(client).toContain("Optional external SEO spend ceiling");
    expect(client).toContain("Your plan already covers included agent work");
    expect(receipt).toContain("actual outside spend this month");
    expect(receipt).toContain("not required for included agent work");
  });
});
