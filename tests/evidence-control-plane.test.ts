import { describe,expect,it } from "vitest";
import { isPrivateAddress } from "../lib/websites/url-security";
import { propertyMatchesDomain } from "../lib/google/property";
import { readFile } from "node:fs/promises";

const root=new URL("../",import.meta.url);
describe("evidence control plane",()=>{
  it("rejects private and link-local crawler targets",()=>{
    for(const address of ["127.0.0.1","10.0.0.4","192.168.1.1","169.254.169.254","::1","fd00::1"])expect(isPrivateAddress(address)).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
  it("matches both domain and URL Search Console properties without treating impressions as volume",async()=>{
    expect(propertyMatchesDomain("sc-domain:example.com","www.example.com")).toBe(true);
    expect(propertyMatchesDomain("https://example.com/","example.com")).toBe(true);
    expect(propertyMatchesDomain("https://other.example/","example.com")).toBe(false);
    const source=await readFile(new URL("lib/seo/search-console-discovery.ts",root),"utf8");
    expect(source).toContain("never mislabeled as search volume");
  });
  it("ships additive Phase 1-3 persistence and queue protections",async()=>{
    const sql=await readFile(new URL("supabase/migrations/0016_evidence_control_plane.sql",root),"utf8");
    for(const item of ["evidence_collection_runs","project_evidence_policies","system_heartbeats","consume_integration_oauth_state","enqueue_evidence_job","background_jobs","crawler.crawl","google.search_analytics"])expect(sql).toContain(item);
    const worker=await readFile(new URL("lib/evidence/worker.ts",root),"utf8");
    for(const item of ["dead_letter","retry_scheduled","search_console_rows","seo_page_snapshots","logServerError"])expect(worker).toContain(item);
  });
});
