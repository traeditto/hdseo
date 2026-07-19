import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {agentServicePlans,defaultManagedTools,planEntitlements} from "../lib/agent-service/catalog";

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
    expect(agentServicePlans.growth.monthlyActionLimit).toBeGreaterThan(0);
    expect(agentServicePlans.agency_scale.cycleCadenceHours).toBeLessThan(agentServicePlans.agency_core.cycleCadenceHours);
    expect(planEntitlements("unknown")).toEqual(agentServicePlans.growth);
    expect(defaultManagedTools).toContain("opportunities.score");
    expect(defaultManagedTools).not.toContain("dns.write");
    expect(defaultManagedTools).not.toContain("legal.publish");
  });

  it("runs only evidence-backed cycles and refuses make-work",()=>{
    const scheduler=read("lib/agent-service/scheduler.ts");
    expect(scheduler).toContain('.gte("opportunity_score",55)');
    expect(scheduler).toContain('status:"no_action"');
    expect(scheduler).toContain('recommendation:opportunity.data?null:"NO_ACTION"');
    expect(scheduler).toContain("consume_agent_service_capacity");
    expect(scheduler).toContain("const providerCost=0");
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

  it("gives agencies a managed-client workspace and owners a simple Autopilot view",()=>{
    const panel=read("app/ui/agent-service-panel.tsx"),agency=read("app/ui/live-agency-dashboard.tsx"),client=read("app/ui/live-client-dashboard.tsx");
    for(const text of ["HD SEO AUTOPILOT","WHITE-LABEL AGENT TEAM","No busywork","Plain-language approval inbox","ACTIONS LEFT","PROVIDER BUDGET LEFT"])expect(panel).toContain(text);
    expect(agency).toContain('"Agent Service"');
    expect(client).toContain('["autopilot", "Autopilot"');
  });

  it("activates and pauses managed service with the Stripe subscription lifecycle",()=>{
    const checkout=read("app/api/billing/checkout/route.ts"),webhook=read("app/api/billing/webhook/route.ts"),env=read(".env.example");
    expect(checkout).toContain("metadata[plan_key]");
    expect(webhook).toContain("agent_service_enrollments");
    expect(webhook).toContain('kind==="agent_capacity"');
    expect(env).toContain("STRIPE_PRICE_AGENT_CAPACITY=");
  });
});
