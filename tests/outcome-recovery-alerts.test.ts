import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/0043_outcome_recovery_alert_cleanup.sql","utf8");

describe("outcome recovery alert cleanup",()=>{
  it("resolves only exact obsolete recovery alerts after a committed outcome",()=>{
    expect(sql).toContain("after update of status on public.outcome_loop_runs");
    expect(sql).toContain("new.status='completed'");
    expect(sql).toContain("cycle_id=new.cycle_id or cycle_id is null");
    expect(sql).toContain("verified outcome could not be committed to the usage ledger");
    expect(sql).toContain("b.status='committed'");
    expect(sql).toContain("verifiedRecovery");
    expect(sql).not.toContain("delete from public.agent_service_escalations");
  });
});
