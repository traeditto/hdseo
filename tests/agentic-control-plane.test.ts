import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,expect,it } from "vitest";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("agent-first operating environment",()=>{
  it("defines the shared work-item, approval, memory, tool, and activity model",()=>{
    const sql=read("supabase/migrations/0017_agentic_control_plane.sql");
    for(const table of ["agent_definitions","agent_tools","agent_tool_grants","agent_work_items","agent_work_steps","agent_approvals","agent_memory","agent_tool_executions","agent_activity_events"])expect(sql).toContain(`public.${table}`);
    for(const field of ["goal","evidence","proposed_plan","authorized_tools","spending_limit","risk_level","required_approvals","validation_results","final_outcome","idempotency_key"])expect(sql).toContain(field);
    expect(sql).toContain("enqueue_agent_work_item");
    expect(sql).toContain("security definer");
    expect(sql).toContain("TOOL_NOT_AUTHORIZED");
    expect(sql).toContain("enable row level security");
  });

  it("registers every specialist and a bounded tool registry",()=>{
    const registry=read("lib/agents/registry.ts"),sql=read("supabase/migrations/0017_agentic_control_plane.sql");
    for(const agent of ["onboarding","research","strategy","technical_seo","content","local_seo","implementation","qa","reporting","supervisor"]){expect(registry).toContain(`key:"${agent}"`);expect(sql).toContain(`('${agent}'`);}
    for(const tool of ["google.search_console.read","keywords.discover","website.crawl","cms.publish","github.write","vercel.deploy","vercel.rollback","dns.write","pricing.change","legal.publish","lighthouse.run","seo.validate","audit.read"])expect(sql).toContain(tool);
    expect(sql).toContain("request_only");
    expect(sql).toContain("AGENT_RISK_CEILING_EXCEEDED");
    expect(sql).toContain("APPROVAL_REQUIRED");
  });

  it("supervises budgets, approvals, evidence waits, retries, dead letters, and audit history",()=>{
    const supervisor=read("lib/agents/supervisor.ts");
    for(const safeguard of ["enforceBudget","enforceApprovals","authorized_tools.includes","awaiting_approval","waiting_for_tools","dead_letter","max_attempts","agent_tool_executions","agent_memory","agent_activity_events","system_heartbeats"])expect(supervisor).toContain(safeguard);
    expect(supervisor).toContain("DEPENDENCY_FAILED");
    expect(supervisor).toContain("pendingEvidenceJobs");
    expect(supervisor).toContain("Research completed without inventing work");
    expect(supervisor).toContain("waitingSince");
    expect(supervisor).toContain('.in("status",["ready","running"])');
    expect(supervisor).toContain('.in("status",["ready","waiting"])');
    expect(supervisor).toContain('component:"agents"');
    expect(supervisor).toContain('p_queue:"agents"');
  });

  it("exposes a tenant-scoped Agent Workspace and unified approval inbox",()=>{
    const route=read("app/api/agents/workspace/route.ts"),ui=read("app/ui/agent-workspace.tsx"),dashboard=read("app/ui/live-agency-dashboard.tsx");
    expect(route).toContain("requireLiveAgencyProject");
    expect(route).toContain("enforceRateLimit");
    expect(route).toContain('"execution.approve"');
    expect(route).toContain("requestManagedAgentServiceCycle");
    expect(route).toContain("resumeEvidenceBlockedAgentWork");
    expect(route).not.toContain('sourceType:"agent_workspace_team"');
    expect(ui).toContain("Requests the next managed cycle through your plan allowance");
    expect(ui).not.toContain("Paid research limit");
    for(const label of ["Agent Workspace","Agent activity","Approval inbox","MONEY USED","EXPECTED VALUE","DEPLOYMENT SAFETY","Run agent team"] )expect(ui).toContain(label);
    expect(dashboard).toContain('"Agent Workspace"');
  });

  it("starts the initial agent team from the structured onboarding profile",()=>{
    const store=read("lib/live/store.ts"),controlPlane=read("lib/agents/control-plane.ts"),supervisor=read("lib/agents/supervisor.ts"),cron=read("app/api/cron/automation/route.ts");
    expect(store).toContain("seedOnboardingAgentTeam");
    expect(store).toContain("resumeEvidenceBlockedAgentWork");
    expect(controlPlane).toContain("agent.evidence-recovered:");
    expect(controlPlane).toContain("asObject(work.final_outcome).code");
    expect(supervisor).toContain('eq("work_type","research.discovery")');
    expect(supervisor).toContain("waiting for the Research Agent to finish prioritizing opportunities");
    for(const workType of ["onboarding.profile","technical.audit","research.discovery","strategy.roadmap","reporting.summary"])expect(controlPlane).toContain(workType);
    expect(cron).toContain("processAgentBatch");
  });

  it("authorizes retail business owners without granting agency membership",()=>{
    const sql=read("supabase/migrations/0037_retail_agent_enqueue_authorization.sql");
    expect(sql).toContain("public.client_members");
    expect(sql).toContain("client_organization_id=v_organization_id");
    expect(sql).toContain("role in ('client_admin','client_approver')");
    expect(sql).toContain("REQUESTER_NOT_AUTHORIZED");
    expect(sql).toContain("PROJECT_NOT_FOUND");
    expect(sql).toContain("TOOL_NOT_AUTHORIZED");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("from public,anon,authenticated");
  });
});
