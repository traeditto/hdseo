import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";
const root=new URL("../",import.meta.url);
describe("durable platform structure",()=>{
  it("creates tenant-scoped provider, job, execution and monitoring tables",async()=>{const sql=await readFile(new URL("supabase/migrations/0006_campaign_execution.sql",root),"utf8");for(const item of ["seo_campaign_jobs","claim_seo_campaign_job","repository_connections","seo_execution_files","webhook_deliveries","seo_monitoring_checkpoints","for update skip locked"])expect(sql).toContain(item);});
  it("keeps GitHub execution atomic, draft-only, and merge-free",async()=>{const github=await readFile(new URL("lib/github/app-client.ts",root),"utf8");expect(github).toContain("git/trees");expect(github).toContain("git/commits");expect(github).toContain("draft:true");expect(github).not.toMatch(/\/merges|force:true|mergePullRequest/);});
  it("requires tenant context on paid and execution routes",async()=>{for(const path of ["app/api/data/[operation]/route.ts","app/api/campaigns/generate/route.ts","app/api/executions/[executionId]/review/route.ts"]){const source=await readFile(new URL(path,root),"utf8");expect(source).toContain("resolveTenantContext");expect(source).toContain("requirePermission");}});
  it("verifies webhook signatures and records replay identifiers",async()=>{for(const path of ["app/api/webhooks/github/route.ts","app/api/webhooks/vercel/route.ts"]){const source=await readFile(new URL(path,root),"utf8");expect(source).toContain("verifyWebhookSignature");expect(source).toContain("webhook_deliveries");}});
  it("authorizes all three portals server-side",async()=>{const source=await readFile(new URL("lib/auth/portal-access.ts",root),"utf8");for(const table of ["platform_admins","agency_members","client_members"])expect(source).toContain(table);const route=await readFile(new URL("app/api/auth/portal-access/route.ts",root),"utf8");expect(route).toContain("resolvePortalAccess");});
});
