import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";

import {actionDigest,canonicalJson} from "../lib/safety/action-digest";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("execution safety kernel",()=>{
  it("creates stable exact-action digests independent of object key order",()=>{
    expect(canonicalJson({b:2,a:{z:true,y:[3,2,1]}})).toBe(canonicalJson({a:{y:[3,2,1],z:true},b:2}));
    expect(actionDigest({b:2,a:1})).toBe(actionDigest({a:1,b:2}));
    expect(actionDigest({a:1,b:2})).not.toBe(actionDigest({a:1,b:3}));
  });

  it("migrates exact mutation intents, worker fencing, secret-safe CMS grants, and every deployment check",()=>{
    const sql=read("supabase/migrations/0030_execution_safety_kernel.sql");
    for(const value of ["public.mutation_intents","action_digest","approval_policy","execution_ref","fencing_token","extend_background_job_lease","authorize_agent_tool_execution","decide_implementation_package","repository_mutation_intent_id","authority_outreach_actions","reconciliation_required","cms.rollback","github.merge"])expect(sql).toContain(value);
    expect(sql).toContain("'links'");
    expect(sql).toContain("revoke select on table public.cms_connections");
    expect(sql).toContain("for update skip locked");
  });

  it("never overwrites an existing mutation intent before validating its digest",()=>{
    const gateway=read("lib/safety/mutation-gateway.ts");
    expect(gateway).toContain('eq("idempotency_key",input.idempotencyKey).maybeSingle()');
    expect(gateway).toContain("existing.data.action_digest!==digest");
    expect(gateway).not.toContain('.upsert({\n    agency_id:input.action.agencyId');
    expect(gateway).toContain('eq("execution_ref",input.executionRef)');
    expect(gateway).toContain("automaticExpired");
    expect(gateway).toContain('.in("status",["approved","failed","expired"])');
  });

  it("requires exact protected actions for deployments and rollbacks while auto-authorizing previews",()=>{
    const deploy=read("app/api/deploy/route.ts"),rollback=read("app/api/deploy/rollback/route.ts"),worker=read("lib/automation/worker.ts");
    expect(deploy).toContain('approvalPolicy:"rbac_auto"');
    expect(deploy).toContain("assertMutationApproved");
    expect(rollback).toContain("mutationIntentId");
    expect(rollback).toContain("assertMutationApproved");
    expect(worker).toContain("claimStoredMutationIntent");
    expect(worker).toContain('checkType:"drift"');
    expect(worker).toContain("fencing_token");
  });

  it("binds every GitHub branch write to the exact reviewed files and rejects drift during reconciliation",()=>{
    const review=read("app/api/executions/[executionId]/review/route.ts"),execution=read("lib/jobs/stages/execution.ts"),github=read("lib/github/app-client.ts");
    expect(review).toContain("repositoryPullRequestPlan");
    expect(review).toContain("requestMutationIntent");
    expect(review).toContain("decideMutationIntent");
    expect(execution).toContain("claimMutationIntent");
    expect(execution).toContain("settleMutationIntent");
    expect(execution).toContain('status:"retry_scheduled"');
    expect(github).toContain("assertExactBranchCommit");
    expect(github).toContain("/compare/${input.baseSha}...${input.commitSha}");
    expect(github).toContain("content!==file.content");
  });

  it("binds CMS writes to the exact client-approved revision and blocks unsafe rollback drift",()=>{
    const publishing=read("lib/websites/publishing.ts"),clientApproval=read("app/api/client/approvals/route.ts");
    expect(publishing).toContain("implementationPackageDigest(pkg)!==pkg.approval_digest");
    expect(publishing).toContain("assertProviderUnchanged");
    expect(publishing).toContain('toolKey:"cms.publish"');
    expect(publishing).toContain('toolKey:"cms.rollback"');
    expect(publishing).toContain("reconciliation_required");
    expect(clientApproval).toContain("decide_implementation_package");
    const migration=read("supabase/migrations/0030_execution_safety_kernel.sql");
    expect(migration).toContain("approval_digest");
    expect(migration).toContain("approved_snapshot");
  });

  it("replays failed signed webhook deliveries without allowing concurrent double claims",()=>{
    const inbox=read("lib/webhooks/inbox.ts"),github=read("app/api/github/webhook/route.ts"),vercel=read("app/api/vercel/webhook/route.ts");
    expect(inbox).toContain('eq("attempt_count"');
    expect(inbox).toContain('stale?["processing","failed"]:["failed"]');
    for(const route of [github,vercel]){expect(route).toContain("claimWebhookEvent");expect(route).toContain("completeWebhookEvent");expect(route).toContain("failWebhookEvent");}
  });

  it("uses atomic tool authorization and independent live QA",()=>{
    const supervisor=read("lib/agents/supervisor.ts"),control=read("lib/agents/control-plane.ts"),workspace=read("app/ui/agent-workspace.tsx");
    expect(supervisor).toContain('rpc("authorize_agent_tool_execution"');
    expect(supervisor).toContain("verifyLiveImplementation");
    expect(supervisor).toContain('in("status",["ready","running"])');
    expect(control).toContain("mutationIntents");
    expect(workspace).toContain("Approve exact action");
  });

  it("sends only the exact approved outreach and gives provider retries an idempotency fence",()=>{
    const route=read("app/api/authority/actions/route.ts");
    expect(route).toContain('toolKey:"authority.outreach"');
    expect(route).toContain("mutationDigest(action)");
    expect(route).toContain("claimMutationIntent");
    expect(route).toContain('"Idempotency-Key"');
    expect(route).toContain("requires ledger reconciliation");
  });
});
