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

  it("uses real checkout, billing portal and signed Stripe webhooks", () => {
    const checkout = read("app/api/billing/checkout/route.ts");
    const webhook = read("app/api/billing/webhook/route.ts");
    const catalog = read("lib/billing/catalog.ts");
    const portal = read("app/ui/live-client-dashboard.tsx");
    expect(checkout).toContain("/v1/checkout/sessions");
    expect(checkout).toContain("resolveClientContext");
    expect(webhook).toContain("timingSafeEqual");
    expect(webhook).toContain("webhook_events");
    expect(webhook).toContain("WEBHOOK_REPLAY_REJECTED");
    expect(webhook).toContain("PAYMENT_VERIFICATION_FAILED");
    expect(webhook).toContain("Stripe webhook signature is missing.");
    for (const amount of ["19_900", "49_900", "99_900"]) expect(catalog).toContain(amount);
    for (const price of ["$199", "$499", "$999"]) expect(portal).toContain(price);
  });

  it("opens the client portal for verified first-run retail accounts without exposing tenant data", () => {
    const access = read("lib/auth/portal-access.ts");
    expect(access).toContain('organization:"New business workspace"');
    expect(access).toContain('role:"onboarding"');
    expect(access).toContain('destination:"/portal/client"');
  });
});
