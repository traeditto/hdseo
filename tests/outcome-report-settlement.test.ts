import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const supervisor=readFileSync("lib/agents/supervisor.ts","utf8");
const sql=readFileSync("supabase/migrations/0044_outcome_report_step_settlement.sql","utf8");

describe("outcome report settlement",()=>{
  it("durably completes customer-visible progress before waking the next pass",()=>{
    const workUpdate=supervisor.indexOf('db.from("agent_work_items").update({status:"succeeded"');
    const reportUpdate=supervisor.indexOf('db.from("outcome_loop_steps").update({');
    const wake=supervisor.indexOf("await wakeManagedAgentService",workUpdate);
    expect(workUpdate).toBeGreaterThan(-1);
    expect(reportUpdate).toBeGreaterThan(workUpdate);
    expect(wake).toBeGreaterThan(reportUpdate);
    expect(supervisor).toContain('work.work_type==="reporting.summary"');
  });

  it("repairs only tenant-matched successful outcome reports",()=>{
    expect(sql).toContain("after update of status on public.agent_work_items");
    expect(sql).toContain("new.source_type='outcome_loop'");
    expect(sql).toContain("new.work_type='reporting.summary'");
    expect(sql).toContain("r.client_organization_id=c.organization_id");
    expect(sql).toContain("s.step_key='report'");
    expect(sql).toContain("w.status='succeeded'");
    expect(sql).not.toContain("delete from public.outcome_loop_steps");
  });
});
