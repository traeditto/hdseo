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

  it("prepares managed outcomes automatically and pauses only on an exact accountable decision", () => {
    const stages = read("lib/jobs/stages/intelligence.ts");
    const packages = read("lib/manual/package-service.ts");
    expect(stages).toContain("if(managedOutcome)");
    expect(stages).toContain("prepareCampaignCreativeHandoff");
    expect(stages).toContain('approvalOwner');
    expect(stages).toContain('"awaiting_manual_completion"');
    expect(packages).toContain("publishForClientReview");
    expect(packages).toContain('status:"awaiting_client"');
    expect(packages).toContain("could not be added to the client approval inbox");
  });

  it("shows managed decisions in the business owner approval inbox", () => {
    const portal = read("app/ui/live-client-dashboard.tsx");
    const panel = read("app/ui/agent-service-panel.tsx");
    expect(portal).toContain("managedDecisionCount");
    expect(portal).toContain("decisionsOnly");
    expect(panel).toContain("AUTOPILOT DECISIONS");
    expect(panel).toContain("onDecisionCount");
  });

  it("wakes the outcome supervisor immediately after a client decision", () => {
    const store = read("lib/live/store.ts");
    const clientApi = read("app/api/client/approvals/route.ts");
    expect(store).toContain('reason:"approval_decided"');
    expect(clientApi).toContain('reason:"approval_decided"');
  });

  it("rotates expired preview access, retries transient QA, and advances the campaign", () => {
    const worker = read("lib/automation/worker.ts");
    expect(worker).toContain("forceRefresh:true");
    expect(worker).toContain('"PREVIEW_VALIDATION_RETRY"');
    expect(worker).toContain("reconcilePreviewCampaigns");
    expect(worker).toContain('status:"awaiting_release_approval"');
    expect(worker).toContain("reconcileCampaignForExecution");
    expect(worker).toContain('job.job_type==="deployment.validate"');
    expect(worker).toContain('validationModelVersion:"preview-aware-v2"');
    expect(worker).toContain("preview_indexing_policy_upgrade");
    expect(worker).toContain("validationUrl");
  });

  it("continues the exact approved package instead of reapplying the discovery threshold", () => {
    const scheduler = read("lib/agent-service/scheduler.ts");
    const store = read("lib/live/store.ts");
    const clientApi = read("app/api/client/approvals/route.ts");
    expect(scheduler).toContain("continueApprovedImplementationPackage");
    expect(scheduler).toContain("approved-package:${pkg.id}:v${pkg.version??1}");
    expect(scheduler).toContain('eq("status","client_approved")');
    expect(scheduler).toContain("approvedPackageId:approved.pkg.id");
    expect(scheduler).toContain('status:"implementation_queued"');
    expect(store).toContain("continueApprovedImplementationPackage");
    expect(clientApi).toContain("continueApprovedImplementationPackage");
  });

  it("advances an already-reserved outcome after approval instead of charging capacity twice", () => {
    const scheduler = read("lib/agent-service/scheduler.ts");
    expect(scheduler).toContain("continueApprovedActiveCampaign");
    expect(scheduler).toContain("reusedReservedOutcome:true");
    expect(scheduler).toContain('eq("outcome_run_id",run.id)');
    expect(scheduler).toContain('current_stage:targetStage');
    expect(scheduler).toContain('targetStage=path.kind==="repository"?"inspect_repository":"prepare"');
  });

  it("surfaces the generated repository diff as the next plain-language approval", () => {
    const service = read("lib/agent-service/service.ts");
    const panel = read("app/ui/agent-service-panel.tsx");
    expect(service).toContain('.eq("status","awaiting_review")');
    expect(service).toContain('kind:"execution"');
    expect(service).toContain("Review the exact website change");
    expect(panel).toContain('`/api/executions/${item.id}/review`');
    expect(panel).toContain("Approve exact change");
    expect(panel).toContain("Request revision");
  });

  it("requires approved creative and targets only the intended public page", () => {
    const intelligence = read("lib/jobs/stages/intelligence.ts");
    const execution = read("lib/jobs/stages/execution.ts");
    const validation = read("lib/execution/validation.ts");
    expect(intelligence).toContain("prepareCampaignCreativeHandoff");
    expect(execution).toContain("app/[slug]/page.tsx");
    expect(execution).toContain("will not modify unrelated application code");
    expect(validation).toContain("protected application or administrative code is not an SEO page target");
  });

  it("authorizes a business owner to review only their own generated execution", () => {
    const route = read("app/api/executions/[executionId]/review/route.ts");
    expect(route).toContain("requireLiveAgencyProject");
    expect(route).toContain('permission:"execution.approve"');
    expect(route).toContain("context.agencyId!==input.agencyId||context.clientId!==input.clientId");
    expect(route).not.toContain("resolveTenantContext");
  });

  it("fails closed without spending capacity when publishing access is not verified", () => {
    const scheduler = read("lib/agent-service/scheduler.ts");
    const connectionBlock = scheduler.indexOf('failure_code:"CONNECTION_REQUIRED"');
    const reservation = scheduler.indexOf("const reservation=await reserveOutcome");
    expect(connectionBlock).toBeGreaterThan(0);
    expect(connectionBlock).toBeLessThan(reservation);
    expect(scheduler).toContain("No outcome capacity has been used");
    expect(scheduler).toContain('failure_code:"ACTIVE_WORK"');
  });

  it("wakes approvals that were already stranded before the handoff shipped", () => {
    const migration = read("supabase/migrations/0041_approved_package_execution_handoff.sql");
    expect(migration).toContain("next_cycle_at=least(e.next_cycle_at,now())");
    expect(migration).toContain("p.status='client_approved'");
    expect(migration).toContain("c.implementation_package_id=p.id");
  });
});
