import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");

describe("verified outcome recovery",()=>{
  it("recovers only a released reservation with exact production proof",()=>{
    const sql=read("supabase/migrations/0042_verified_outcome_recovery.sql");
    expect(sql).toContain("commit_verified_recovered_outcome");
    expect(sql).toContain("if b.status<>'released'");
    expect(sql).toContain("outcome_run_id=r.id");
    expect(sql).toContain("d.environment<>'production'");
    expect(sql).toContain("d.status<>'healthy'");
    expect(sql).toContain("x.production_deployed_at is null");
    expect(sql).toContain("execution_id=r.execution_id");
    expect(sql).toContain("VERIFIED_RECOVERY_MONITORING_MISSING");
  });

  it("reclaims capacity exactly once and preserves the immutable release event",()=>{
    const sql=read("supabase/migrations/0042_verified_outcome_recovery.sql");
    expect(sql).toContain("if b.status='committed' or r.status='completed'");
    expect(sql).toContain("e.actions_used<e.monthly_action_limit");
    expect(sql).toContain("set actions_used=actions_used+1");
    expect(sql).toContain("recoveryCredit");
    expect(sql).toContain("on conflict(event_key) do nothing");
    expect(sql).not.toContain("delete from public.billable_usage_events");
    expect(sql).toContain("grant execute on function public.commit_verified_recovered_outcome");
  });

  it("uses recovery only after the normal commit rejects a released ledger",()=>{
    const service=read("lib/agent-service/outcome-loop.ts");
    const normal=service.indexOf('db.rpc("commit_outcome_loop_run"');
    const inspect=service.indexOf('from("billable_usage_reservations")');
    const recover=service.indexOf('db.rpc("commit_verified_recovered_outcome"');
    expect(normal).toBeGreaterThan(-1);
    expect(normal).toBeLessThan(inspect);
    expect(inspect).toBeLessThan(recover);
    expect(service).toContain('reservation.data?.status!=="released"');
  });
});
