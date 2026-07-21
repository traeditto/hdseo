import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("billable managed outcome loop",()=>{
  it("reserves one capacity unit idempotently for one customer-visible outcome",()=>{
    const sql=read("supabase/migrations/0038_billable_outcome_loop_ledger.sql");
    expect(sql).toContain("unique(enrollment_id,run_key)");
    expect(sql).toContain("outcome_run_id uuid not null unique");
    expect(sql).toContain("'outcome:'||r.id");
    expect(sql).toContain("if r.id is not null then");
    expect(sql).toContain("if b.id is not null then");
    expect(sql).toContain("if b.status='reserved' then");
    expect(sql).toContain("OUTCOME_RUN_ALREADY_FINAL");
    expect(sql).toContain("'duplicate',true");
    expect(sql).toContain("actions_used=actions_used+1");
    expect(sql.indexOf("if b.id is not null then")).toBeLessThan(sql.indexOf("actions_used=actions_used+1"));
    expect(sql).toContain("one completed customer-visible SEO outcome");
    const scheduler=read("lib/agent-service/scheduler.ts");
    expect(scheduler).toContain("resumeCapacityBlock");
    expect(scheduler).toContain('"already_processed"');
    expect(scheduler).not.toContain('upsert({\n    enrollment_id:enrollment.id');
  });

  it("earns usage only after non-empty verified delivery proof is committed",()=>{
    const sql=read("supabase/migrations/0038_billable_outcome_loop_ledger.sql");
    const commit=sql.slice(sql.indexOf("create or replace function public.commit_outcome_loop_run"),sql.indexOf("create or replace function public.release_outcome_loop_run"));
    expect(commit).toContain("p_delivery_proof");
    expect(commit).toContain("'{}'::jsonb");
    expect(commit).toContain("INVALID_DELIVERY_PROOF");
    expect(commit).toContain("if b.status='committed' then return false");
    expect(commit).toContain("if b.status<>'reserved'");
    expect(commit).toContain("'completed_outcome'");
    expect(commit).toContain("'creditStatus','earned'");
    expect(commit.indexOf("status='committed'")).toBeLessThan(commit.indexOf("insert into public.agent_service_usage"));
  });

  it("commits only after deployment or CMS proof and outcome monitoring exist",()=>{
    const scheduler=read("lib/agent-service/scheduler.ts");
    const verifyStart=scheduler.indexOf("async function verifiedDelivery");
    const completeStart=scheduler.indexOf("async function completeCampaignOutcome");
    const directStart=scheduler.indexOf("async function ensureDirectCmsExecution");
    const verification=scheduler.slice(verifyStart,completeStart);
    const completion=scheduler.slice(completeStart,directStart);
    expect(verification).toContain("production_deployed_at");
    expect(verification).toContain("seo_monitoring_plans");
    expect(verification).toContain('eq("status","passed")');
    expect(verification).toContain("implementation_verifications");
    expect(completion).toContain("if(!delivery)");
    expect(completion).toContain("return true");
    expect(completion).toContain("commitOutcome");
    expect(completion.indexOf("if(!delivery)")).toBeLessThan(completion.indexOf("commitOutcome"));
    const direct=scheduler.slice(directStart,scheduler.indexOf("async function createCampaignHandoff"));
    expect(direct).toContain('eq("status","passed")');
    expect(direct.indexOf('eq("status","passed")')).toBeLessThan(direct.indexOf('pkg.data.status!=="client_approved"'));
  });

  it("binds CMS publishing and independent QA to the exact reserved outcome package",()=>{
    const supervisor=read("lib/agents/supervisor.ts"),scheduler=read("lib/agent-service/scheduler.ts");
    expect(supervisor).toContain("exactOutcomePackageId");
    expect(supervisor).toContain("waitForOutcomeImplementation");
    expect(supervisor).toContain('eq("package_id",packageId)');
    expect(supervisor).toContain('eq("source_type",work.source_type).eq("source_id",work.source_id)');
    expect(supervisor).toContain("The prior CMS publish succeeded but its exact publication ledger needs reconciliation.");
    expect(scheduler).toContain('eq("source_type","outcome_loop").eq("source_id",run.id)');
    expect(scheduler).toContain("The protected analysis handoff was incomplete");
  });

  it("returns reserved capacity for failed, cancelled, rejected, stale, or empty work",()=>{
    const sql=read("supabase/migrations/0038_billable_outcome_loop_ledger.sql"),scheduler=read("lib/agent-service/scheduler.ts");
    const release=sql.slice(sql.indexOf("create or replace function public.release_outcome_loop_run"),sql.indexOf("create or replace function public.settle_agent_service_provider_cost"));
    expect(release).toContain("greatest(0,actions_used-1)");
    expect(release).toContain("purchased_action_balance=purchased_action_balance+b.prepaid_units");
    expect(release).toContain("if b.status='committed' then raise exception 'COMMITTED_OUTCOME_REQUIRES_CREDIT'");
    expect(release).toContain("if b.id is null or b.status in ('released','credited') then return false");
    expect(scheduler).toContain('["failed","cancelled","stale"].includes(campaign.status)');
    expect(scheduler).toContain('status:campaign.status==="cancelled"?"cancelled":"failed"');
    expect(scheduler).toContain("No specialist work was created; the reserved action was returned.");
    expect(scheduler).toContain("The proposed implementation was rejected before delivery.");
  });

  it("does not bill discovery, specialist handoffs, delivery workers, QA, retries, or reporting separately",()=>{
    const scheduler=read("lib/agent-service/scheduler.ts");
    expect(scheduler).toContain("Evidence collection is included and did not consume an outcome action.");
    expect(scheduler).toContain("resumeEvidenceBlockedAgentWork");
    expect(scheduler).toContain("upgradeLegacyManagedTools");
    expect(scheduler).toContain('proposedPlan:{serviceMode:"managed_agent",billable:false,noMakeWorkRule:true,customerCharge:"one outcome only after verified delivery"}');
    expect(scheduler).toContain('proposedPlan:{serviceMode:"managed_agent",billable:false,exactPackageApproved:true}');
    expect(scheduler).toContain('proposedPlan:{serviceMode:"managed_agent",billable:false,reason:"Reporting is included in the completed outcome."}');
    expect(scheduler).toContain("spendingLimit:0");
    expect(scheduler.match(/reserveOutcome\(/g)).toHaveLength(1);
    expect(scheduler.match(/commitOutcome\(/g)).toHaveLength(1);
    expect(scheduler).not.toContain("consume_agent_service_capacity");
  });

  it("requires an approved, exact-SHA, healthy preview and complete QA before protected merge",()=>{
    const route=read("app/api/executions/[executionId]/release/route.ts"),github=read("lib/github/app-client.ts");
    expect(route).toContain('execution.data.status!=="preview_ready"');
    expect(route).toContain("preview_deployment_id");
    expect(route).toContain("deployment.data.git_sha");
    for(const check of ["health","lighthouse","seo","links","schema","sitemap","robots","indexing_readiness","drift"])expect(route).toContain(`${check}:new Set(`);
    expect(route).toContain('lighthouse:new Set(["passed","warning","skipped"])');
    expect(route).toContain("Protected preview credentials are never sent to external PageSpeed services");
    expect(route).toContain('schema:new Set(["passed","warning"])');
    expect(route).toContain('drift:new Set(["passed","warning","skipped"])');
    expect(route).toContain("missing.length");
    expect(route).toContain("unverified.length");
    expect(route).toContain("requiredChecks");
    expect(route).toContain('approvalPolicy:"human"');
    expect(route).toContain("decideMutationIntent");
    expect(route).toContain("claimMutationIntent");
    expect(route).toContain("expectedHeadSha:deployment.data.git_sha");
    expect(route.indexOf("await claimMutationIntent")).toBeLessThan(route.indexOf("await mergeApprovedPullRequest"));
    expect(github).toContain("expectedHeadSha");
    expect(github).toContain("pull.head.sha!==input.expectedHeadSha");
    expect(github).toContain("merge_method:\"squash\"");
  });
});
