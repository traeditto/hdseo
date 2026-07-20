import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("self-service free trial", () => {
  it("has a dedicated verified signup path with an honest bounded offer", () => {
    const register = read("app/register/page.tsx");
    const login = read("app/ui/portal-login.tsx");
    const signup = read("app/api/auth/signup/route.ts");
    const marketing = read("app/marketing-home.tsx") + read("app/marketing-shared.tsx");

    expect(register).toContain('initialMode="signup"');
    expect(signup).toContain("self_service_free_trial");
    expect(signup).toContain("emailRedirectTo");
    expect(login).toContain("productionAuthOrigin");
    expect(login).toContain("showSignupPassword");
    expect(login).toContain('aria-label={showSignupPassword?"Hide password":"Show password"}');
    expect(login).toContain("That confirmation link is invalid, expired, or was already used.");
    expect(login).toContain("Resend verification email");
    expect(read("app/api/auth/recovery/route.ts")).toContain('db.auth.resend({type:"signup"');
    expect(login).toContain("One crawl of up to 25 public pages");
    expect(login).toContain("No credit card required");
    expect(marketing).toContain('href="/register"');
  });

  it("completes both PKCE and token-hash email confirmations in the correct portal", () => {
    const callback = read("app/auth/callback/route.ts");

    expect(callback).toContain("exchangeCodeForSession");
    expect(callback).toContain("token_hash");
    expect(callback).toContain("verifyOtp");
    expect(callback).toContain('return "/login/client"');
    expect(callback).toContain("appBaseUrl()");
  });

  it("completes password recovery instead of returning users to a dead-end login", () => {
    const recovery = read("app/api/auth/recovery/route.ts");
    const callback = read("app/auth/callback/route.ts");
    const reset = read("app/ui/reset-password-form.tsx");

    expect(recovery).toContain("/reset-password?portal=${input.portal}");
    expect(recovery).toContain("/auth/callback?next=");
    expect(callback).toContain('next.startsWith("/reset-password")');
    expect(reset).toContain("db.auth.updateUser({password})");
    expect(reset).toContain("Save password and continue");
    expect(reset).toContain("Show passwords");
  });

  it("serializes and accounts for the single free crawl in Postgres", () => {
    const migration = read("supabase/migrations/0031_self_service_free_trial.sql");

    expect(migration).toContain("create table public.client_trial_entitlements");
    expect(migration).toContain("create table public.client_trial_usage");
    expect(migration).toContain("for update");
    expect(migration).toContain("claim_client_website_crawl");
    expect(migration).toContain("settle_client_trial_crawl");
    expect(migration).toContain("unique(project_id,benefit_key,idempotency_key)");
    expect(migration).toContain("grant execute on function public.claim_client_website_crawl(uuid,text) to service_role");
  });

  it("queues a bounded crawl and does not start paid agent work for the trial", () => {
    const route = read("app/api/crawler/run/route.ts");
    const store = read("lib/live/store.ts");
    const worker = read("lib/evidence/worker.ts");

    expect(route).toContain("trial-crawl:");
    expect(route).toContain("maxPages:25");
    expect(route).toContain("markTrialCrawlQueued");
    expect(store).toContain('crawlAccess.mode==="trial"?[]:await seedOnboardingAgentTeam');
    expect(worker).toContain('settleTrialCrawl(db,{jobId:job.id,status:"succeeded"})');
    expect(worker).toContain('settleTrialCrawl(db,{jobId:job.id,status:"failed"');
  });

  it("keeps paid work in preview mode until the customer upgrades", () => {
    const dashboard = read("app/ui/live-client-dashboard.tsx");
    const errors = read("lib/api/errors.ts");

    expect(dashboard).toContain("TrialAutopilotPreview");
    expect(dashboard).toContain("Paid keyword data, ongoing agents, publishing, and external spend remain locked");
    expect(dashboard).toContain("Run my free 25-page crawl");
    expect(errors).toContain("TRIAL_LIMIT_REACHED");
    expect(errors).toContain("TRIAL_EXPIRED");
  });
});
