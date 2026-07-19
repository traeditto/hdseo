import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {agencyBillingPlans} from "../lib/billing/agency-catalog";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("paid agency pricing",()=>{
  it("keeps agency tiers bounded and margin-safe",()=>{
    expect(agencyBillingPlans.launch).toMatchObject({priceCents:49_900,includedClients:3,includedScaleClients:0});
    expect(agencyBillingPlans.growth).toMatchObject({priceCents:99_900,includedClients:8,includedScaleClients:2});
    expect(agencyBillingPlans.scale).toMatchObject({priceCents:229_900,includedClients:20,includedScaleClients:5});
  });

  it("requires paid agency billing before workers can claim managed work",()=>{
    const sql=read("supabase/migrations/0029_agency_subscription_pricing.sql");
    expect(sql).toContain("create table public.agency_subscriptions");
    expect(sql).toContain("e.billing_owner='client'");
    expect(sql).toContain("s.status in ('trialing','active')");
  });

  it("exposes checkout, lifecycle handling, and an agency billing screen",()=>{
    expect(read("app/api/agency-billing/checkout/route.ts")).toContain('"metadata[kind]":"agency_subscription"');
    expect(read("app/api/billing/webhook/route.ts")).toContain('kind==="agency_subscription"');
    expect(read("app/ui/live-agency-dashboard.tsx")).toContain('"Billing"');
    expect(read("lib/agent-service/service.ts")).toContain("AGENCY_CLIENT_LIMIT_REACHED");
    expect(read("lib/agent-service/service.ts")).toContain('if(status==="active")');
  });
});
