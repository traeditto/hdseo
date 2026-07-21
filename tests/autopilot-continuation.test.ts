import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Autopilot event-driven continuation", () => {
  it("wakes managed service only through the guarded scheduler", () => {
    const wake = read("lib/agent-service/wake.ts");
    expect(wake).toContain('eq("service_mode", "managed_agent")');
    expect(wake).toContain('.in("status", ["trialing", "active"])');
    expect(wake).toContain("next_cycle_at: timestamp");
    expect(wake).not.toContain("reserveOutcome");
    expect(wake).not.toContain("commitOutcome");
  });

  it("resumes evidence-paused campaigns and wakes Autopilot after the queue drains", () => {
    const worker = read("lib/evidence/worker.ts");
    expect(worker).toContain('eq("status","awaiting_evidence_refresh")');
    expect(worker).toContain('reason:"evidence_ready"');
    expect(worker).toContain("wakeManagedAgentService");
  });

  it("does not convert a recoverable evidence wait into a failed campaign", () => {
    const runner = read("lib/jobs/runner.ts");
    expect(runner).toContain('safe.body.error.code==="EVIDENCE_REFRESH_REQUIRED"');
    expect(runner).toContain('status=waitingForEvidence?"awaiting_evidence_refresh"');
    expect(runner).toContain("nextAttempt=waitingForEvidence?job.attempt_count");
  });

  it("continues automatically after managed discovery without manufacturing work", () => {
    const runner = read("lib/jobs/runner.ts");
    const stages = read("lib/jobs/stages/intelligence.ts");
    const store = read("lib/live/store.ts");
    expect(runner).toContain('reason:"discovery_completed"');
    expect(store).toContain('reason: "opportunity_ready"');
    expect(stages).toContain("no opportunity passed every value and safety gate");
    expect(stages).toContain("Autopilot will try again when the evidence changes");
  });

  it("wakes and reconciles the outcome immediately after specialist work finishes", () => {
    const supervisor = read("lib/agents/supervisor.ts");
    const cron = read("app/api/cron/agent-service/route.ts");
    expect(supervisor).toContain('work.source_type==="outcome_loop"');
    expect(supervisor).toContain('reason:"specialist_completed"');
    expect(cron).toContain(":reconcile");
    expect(cron).toContain("reconciliation");
  });

  it("recovers a same-day stopped discovery instead of losing the idempotency collision", () => {
    const scheduler = read("lib/agent-service/scheduler.ts");
    expect(scheduler).toContain('eq("idempotency_key",idempotencyKey)');
    expect(scheduler).toContain('["failed","stale"].includes(existing.data.status)');
    expect(scheduler).toContain('current_stage:"discover"');
  });
});
