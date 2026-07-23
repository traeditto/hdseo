import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";

import {agencyBillingPlans} from "../lib/billing/agency-catalog";
import {contributionMarginPercent,FOUNDING_BETA_OFFER_KEY,retailBillingPlans} from "../lib/billing/catalog";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("Founding Beta",()=>{
  it("offers every direct business tier with a protected 25% modeled contribution margin",()=>{
    expect(Object.fromEntries(Object.entries(retailBillingPlans).map(([key,plan])=>[key,plan.beta.priceCents]))).toEqual({starter:9_900,growth:24_900,pro:59_900,autopilot_plus:79_900});
    for(const plan of Object.values(retailBillingPlans)){
      expect(plan.beta.priceCents).toBeLessThan(plan.priceCents);
      expect(plan.beta.durationDays).toBe(30);
      expect(contributionMarginPercent(plan.beta.priceCents,plan.beta.maxAllInCostCents)).toBe(25);
      expect(plan.beta.fixedDeliveryReserveCents).toBeLessThan(plan.beta.maxAllInCostCents);
      expect(plan.beta.includedProviderBudgetDollars).toBeGreaterThan(0);
    }
  });

  it("aligns public agency capacity with checkout enforcement and beta economics",()=>{
    expect(agencyBillingPlans.launch).toMatchObject({priceCents:49_900,includedClients:3,beta:{priceCents:29_900}});
    expect(agencyBillingPlans.growth).toMatchObject({priceCents:99_900,includedClients:8,includedScaleClients:2,beta:{priceCents:59_900}});
    expect(agencyBillingPlans.scale).toMatchObject({priceCents:229_900,includedClients:20,includedScaleClients:5,beta:{priceCents:129_900}});
    for(const plan of Object.values(agencyBillingPlans)){
      expect(contributionMarginPercent(plan.beta.priceCents,plan.beta.maxAllInCostCents)).toBe(25);
    }
    const publicCatalog=read("app/pricing-catalog.ts");
    expect(publicCatalog).toContain("agencyBillingPlans.launch");
    expect(publicCatalog).toContain("20 active managed client websites");
    expect(publicCatalog).not.toContain("40 active client websites");
  });

  it("reserves scarce beta capacity atomically and prevents repeat redemption",()=>{
    const sql=read("supabase/migrations/0035_founding_beta_program.sql");
    for(const safeguard of ["beta_offer_enrollments","pg_advisory_xact_lock","BETA_ALREADY_REDEEMED","BETA_TIER_FULL","reservation_expires_at","activate_beta_offer","beta_redeemed_at","enable row level security"])expect(sql).toContain(safeguard);
    expect(sql).toContain("grant execute on function public.reserve_beta_offer");
    expect(sql).toContain("to service_role");
  });

  it("enforces the beta cost ceiling before a provider request can erase margin",()=>{
    const sql=read("supabase/migrations/0049_founding_beta_25_margin_guard.sql");
    for(const safeguard of ["minimum_contribution_margin_pct","all_in_delivery_cost_ceiling","all_in_delivery_cost_used","beta_delivery_cost_events","BETA_DELIVERY_COST_CEILING_REACHED","for update","Founding Beta delivery cost reached"])expect(sql).toContain(safeguard);
    const webhook=read("app/api/billing/webhook/route.ts");
    expect(webhook).toContain("fixedDeliveryReserveCents");
    expect(webhook).toContain("includedProviderBudgetDollars");
    expect(webhook).toContain("targetContributionMarginPercent");
    expect(webhook).toContain("measurementWindowDays");
  });

  it("creates an exact one-invoice Stripe discount and verifies the paid amount",()=>{
    const retail=read("app/api/billing/checkout/route.ts"),agency=read("app/api/agency-billing/checkout/route.ts"),stripe=read("lib/billing/stripe.ts"),webhook=read("app/api/billing/webhook/route.ts");
    for(const checkout of [retail,agency]){
      expect(checkout).toContain("ensureOneTimeAmountCoupon");
      expect(checkout).toContain('body.set("discounts[0][coupon]"');
      expect(checkout).toContain('body.set("metadata[beta_reservation_id]"');
      expect(checkout).toContain("maxAllInCostCents");
    }
    expect(stripe).toContain('duration:"once"');
    expect(webhook).toContain("expected_amount_cents");
    expect(webhook).toContain("activate_beta_offer");
    expect(FOUNDING_BETA_OFFER_KEY).toBe("founding_beta_2026");
    expect(webhook).toContain("FOUNDING_BETA_OFFER_KEY");
  });

  it("leads with Run It For Me without hiding approval and renewal controls",()=>{
    const pricing=read("app/pricing/pricing-experience.tsx"),home=read("app/marketing-home.tsx");
    for(const text of ["Run It For Me","unless canceled","approval","FOUNDING BETA"])expect(`${pricing}\n${home}`.toLowerCase()).toContain(text.toLowerCase());
    expect(home).toContain("No rankings or revenue guarantee");
  });
});
