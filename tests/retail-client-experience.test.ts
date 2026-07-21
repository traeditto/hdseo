import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ");

describe("retail business-owner experience", () => {
  it("creates an atomic, tenant-scoped retail workspace", () => {
    const sql = read("supabase/migrations/0022_retail_client_experience.sql");
    for (const table of ["client_growth_profiles", "client_subscriptions", "client_support_requests"]) expect(sql).toContain(`public.${table}`);
    expect(sql).toContain("create_retail_workspace");
    expect(sql).toContain("revoke all on function public.create_retail_workspace");
    expect(sql).toContain("has_client_access");
  });

  it("never asks an owner to research or enter keywords", () => {
    const portal = read("app/ui/live-client-dashboard.tsx");
    expect(portal).toContain("No keywords required");
    expect(compact(portal)).toContain("discover the relevant searches automatically");
    expect(portal).not.toContain('name="keyword"');
  });

  it("provides simple owner navigation and protected control modes", () => {
    const portal = read("app/ui/live-client-dashboard.tsx");
    for (const label of ["Home", "My Plan", "Approvals", "Results", "My Business", "Safe Autopilot", "Human-reviewed"]) expect(portal).toContain(label);
    expect(compact(portal)).toContain("High-risk, legal, pricing, DNS and destructive work always pauses");
  });

  it("makes missing publishing access impossible for a business owner to overlook", () => {
    const portal = read("app/ui/live-client-dashboard.tsx");
    const store = read("lib/live/store.ts");
    const connections = read("lib/websites/connections.ts");
    for (const copy of [
      "NEEDS YOUR ATTENTION",
      "Finish connecting your website",
      "Analysis works; editing is not connected",
      "Connect my website",
      "PLATFORM DETECTION",
      "I’m not sure—help me",
    ]) expect(portal).toContain(copy);
    expect(portal).toContain("retail_analyze_website");
    expect(portal).toContain("publishingReady");
    expect(store).toContain('connectionMode === "api"');
    expect(store).toContain('connectionMode === "github_app"');
    expect(connections).toContain('clientMembership.data?.role==="client_admin"');
  });

  it("uses real checkout, billing portal and signed Stripe webhooks", () => {
    const checkout = read("app/api/billing/checkout/route.ts");
    const webhook = read("app/api/billing/webhook/route.ts");
    const catalog = read("lib/billing/catalog.ts");
    const portal = read("app/ui/live-client-dashboard.tsx");
    const workspaceState = read("lib/billing/retail-workspace.ts");
    expect(checkout).toContain("/v1/checkout/sessions");
    expect(checkout).toContain("resolveClientContext");
    expect(webhook).toContain("timingSafeEqual");
    expect(webhook).toContain("claimWebhookEvent");
    expect(webhook).toContain("completeWebhookEvent");
    expect(webhook).toContain("failWebhookEvent");
    expect(webhook).not.toContain('from("webhook_events").upsert');
    expect(webhook).toContain("WEBHOOK_REPLAY_REJECTED");
    expect(webhook).toContain("PAYMENT_VERIFICATION_FAILED");
    expect(webhook).toContain("Stripe webhook signature is missing.");
    for (const amount of ["19_900", "49_900", "99_900", "129_900"]) expect(catalog).toContain(amount);
    expect(portal).toContain("retailBillingPlans");
    expect(portal).toContain("FOUNDING_BETA_OFFER_KEY");
    expect(catalog).toContain('label: "Growth Copilot"');
    expect(catalog).toContain('label: "Autopilot"');
    expect(catalog).toContain('label: "Autopilot Plus"');
    expect(webhook).toContain("applyRetailWorkspaceBillingState");
    expect(workspaceState).toContain('agency.data.plan !== "retail"');
    expect(workspaceState).toContain('stripe_subscription_id');
    expect(workspaceState).toContain('status: "active"');
  });

  it("opens the client portal for verified first-run retail accounts without exposing tenant data", () => {
    const access = read("lib/auth/portal-access.ts");
    expect(access).toContain('organization:"New business workspace"');
    expect(access).toContain('role:"onboarding"');
    expect(access).toContain('destination:"/portal/client"');
  });
});
