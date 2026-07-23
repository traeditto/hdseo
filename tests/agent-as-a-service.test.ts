import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {agentServicePlans,defaultManagedTools,planEntitlements,upgradeLegacyManagedTools} from "../lib/agent-service/catalog";
import {calculateModelCost,capacityUnitEconomics,estimateMaximumModelCost} from "../lib/agent-service/economics";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("Agent-as-a-Service",()=>{
  it("defines durable enrollment, cycle, usage, escalation, and agency resale records",()=>{
    const sql=read("supabase/migrations/0026_agent_as_a_service.sql");
    for(const table of ["agent_service_enrollments","agent_service_cycles","agent_service_usage","agent_service_escalations","agency_resale_settings"])expect(sql).toContain(`public.${table}`);
    for(const safeguard of ["service_mode","approval_owner","billing_owner","monthly_action_limit","monthly_provider_budget","risk_ceiling","allowed_tools","external_spend_requires_approval","enable row level security"])expect(sql).toContain(safeguard);
    expect(sql).toContain("claim_due_agent_service_enrollments");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("consume_agent_service_capacity");
    expect(sql).toContain("ACTION_CAPACITY_EXCEEDED");
    expect(sql).toContain("PROVIDER_BUDGET_EXCEEDED");
  });

  it("provides bounded direct and white-label service plans",()=>{
    expect(agentServicePlans.growth).toMatchObject({label:"Growth Copilot",monthlyActionLimit:6,monthlyMajorPageLimit:0,humanReviewMinutes:0});
    expect(agentServicePlans.pro).toMatchObject({label:"Autopilot",monthlyActionLimit:6,monthlyMajorPageLimit:1,humanReviewMinutes:30});
    expect(agentServicePlans.autopilot_plus).toMatchObject({label:"Autopilot Plus",monthlyActionLimit:10,monthlyMajorPageLimit:2,humanReviewMinutes:60});
    expect(agentServicePlans.agency_scale.cycleCadenceHours).toBeLessThan(agentServicePlans.agency_core.cycleCadenceHours);
    expect(planEntitlements("unknown")).toEqual(agentServicePlans.starter);
    expect(defaultManagedTools).toContain("opportunities.score");
    for(const tool of ["growth.plan","internal_links.graph","proof.read","content.refresh","creative.spec","proof.case_study","cms.publish"])expect(defaultManagedTools).toContain(tool);
    expect(defaultManagedTools).not.toContain("dns.write");
    expect(defaultManagedTools).not.toContain("legal.publish");
    const legacy=["website.detect","website.crawl","google.search_console.read","google.analytics.read","google.business_profile.read","keywords.discover","competitors.analyze","opportunities.score","strategy.plan","cms.draft","github.read","lighthouse.run","seo.validate","schema.validate","sitemap.verify","robots.verify","report.generate","audit.read"];
    expect(upgradeLegacyManagedTools(legacy)).toContain("growth.plan");
    expect(upgradeLegacyManagedTools(["audit.read"])).toEqual(["audit.read"]);
  });

  it("runs only evidence-backed cycles and refuses make-work",()=>{
    const scheduler=read("lib/agent-service/scheduler.ts");
    expect(scheduler).toContain('.gte("opportunity_score",45)');
    expect(scheduler).toContain("investmentPolicyForPlan");
    expect(scheduler).toContain('status:opportunity.data?"running":"no_action"');
    expect(scheduler).toContain('recommendation:opportunity.data?null:"NO_ACTION"');
    expect(scheduler).toContain("ensureDiscoveryCampaign");
    expect(scheduler).toContain("reserveOutcome");
    expect(scheduler).toContain("commitOutcome");
    expect(scheduler).toContain("releaseOutcome");
    expect(scheduler).toContain('billable:false');
    expect(scheduler).toContain('spendingLimit:0');
    expect(scheduler).not.toContain("consume_agent_service_capacity");
    expect(scheduler).toContain("approvalOwner:enrollment.approval_owner");
    expect(scheduler).toContain("reconcileActiveCycle");
  });

  it("exposes tenant-scoped lifecycle, metering, approval, and scheduler routes",()=>{
    for(const route of ["status","enroll","pause","resume","change-plan","purchase-capacity","usage","escalations","decide","settings"])expect(read(`app/api/agent-service/${route}/route.ts`)).toContain(route==="status"||route==="usage"||route==="escalations"?"GET":"POST");
    const cron=read("app/api/cron/agent-service/route.ts"),vercel=read("vercel.json");
    expect(cron).toContain("processAgentServiceBatch");
    expect(cron).toContain("processAgentBatch");
    expect(vercel).toContain("/api/cron/agent-service");
  });

  it("allows only the canonical production runtime to claim shared queues",()=>{
    const guard=read("lib/cron/runtime.ts"),env=read("lib/config/env.ts");
    expect(env).toContain("HDSEO_WORKER_RUNTIME");
    expect(guard).toContain('env.HDSEO_WORKER_RUNTIME !== "canonical"');
    expect(guard).toContain("NON_CANONICAL_WORKER_RUNTIME");
    for(const route of ["seo","automation","agent-service"]){
      expect(read(`app/api/cron/${route}/route.ts`)).toContain("guardWorkerCron");
    }
  });

  it("gives agencies a managed-client workspace and owners a simple Autopilot view",()=>{
    const panel=read("app/ui/agent-service-panel.tsx"),agency=read("app/ui/live-agency-dashboard.tsx"),client=read("app/ui/live-client-dashboard.tsx");
    for(const text of ["HD SEO AUTOPILOT","WHITE-LABEL AGENT TEAM","No busywork","Plain-language approval inbox","MONTHLY EXECUTION","EXECUTION CAPACITY LEFT","MAJOR PAGES LEFT","INTERNAL COST CAP LEFT"])expect(panel).toContain(text);
    expect(panel).toContain("one major campaign or several smaller improvements");
    expect(agency).toContain('"Agent Service"');
    expect(client).toContain('["autopilot", "Autopilot"');
  });

  it("activates and pauses managed service with the Stripe subscription lifecycle",()=>{
    const checkout=read("app/api/billing/checkout/route.ts"),webhook=read("app/api/billing/webhook/route.ts"),env=read(".env.example");
    expect(checkout).toContain("metadata[plan_key]");
    expect(webhook).toContain("agent_service_enrollments");
    expect(webhook).toContain('kind==="agent_capacity"');
    expect(webhook).toContain('planKey==="pro"||planKey==="autopilot_plus"?"managed_agent":"copilot"');
    expect(env).toContain("STRIPE_PRICE_AUTOPILOT_PLUS_MONTHLY=");
    expect(env).toContain("STRIPE_PRICE_AGENT_CAPACITY=");
  });

  it("enforces major-page capacity as an idempotent database entitlement",()=>{
    const sql=read("supabase/migrations/0034_profit_aligned_retail_pricing.sql"),execution=read("lib/jobs/stages/execution.ts");
    expect(sql).toContain("consume_agent_service_major_page");
    expect(sql).toContain("MAJOR_PAGE_CAPACITY_EXCEEDED");
    expect(sql).toContain("monthly_major_page_limit");
    expect(execution).toContain("reserveManagedMajorPage");
    expect(execution).toContain("consume_agent_service_major_page");
  });

  it("hard-stops model and provider costs before they can erase margin",()=>{
    const sql=read("supabase/migrations/0027_profit_guarded_agent_capacity.sql"),cost=read("lib/agent-service/cost-control.ts"),openai=read("lib/creatives/openai.ts"),webhook=read("app/api/billing/webhook/route.ts");
    for(const safeguard of ["reserve_model_usage","PROJECT_DAILY_MODEL_BUDGET_EXCEEDED","PLATFORM_DAILY_MODEL_BUDGET_EXCEEDED","reserve_agent_service_provider_cost","purchased_action_balance","purchased_provider_balance"])expect(sql).toContain(safeguard);
    expect(read("supabase/migrations/0028_billing_idempotency.sql")).toContain("credit_agent_capacity_purchase");
    expect(cost).toContain("OPENAI_MAX_COST_PER_REQUEST_USD");
    expect(cost).toContain("OPENAI_MAX_DAILY_COST_PER_PROJECT_USD");
    expect(read("lib/providers/paid-operation.ts")).toContain("MAX_DAILY_DATAFORSEO_PLATFORM_COST_USD");
    expect(openai).toContain("settleModelCost");
    expect(webhook).toContain('payment_status!=="paid"');
    expect(webhook).toContain("agentCapacityAddOn.providerBudgetPerAction");
    expect(calculateModelCost("gpt-5.6-terra",{inputTokens:10_000,cachedInputTokens:0,outputTokens:4_500})).toBe(.0925);
    expect(estimateMaximumModelCost("gpt-5.6-terra","x".repeat(40_000),4_500)).toBe(.0925);
    const economics=capacityUnitEconomics({priceCents:1500,providerBudgetDollars:3});
    expect(economics.contributionMarginPercent).toBeGreaterThanOrEqual(70);
    expect(economics.maxVariableCostCents).toBeLessThan(450);
  });
});
