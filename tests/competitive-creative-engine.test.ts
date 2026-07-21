import{readFileSync}from"node:fs";
import{join}from"node:path";
import{describe,expect,it}from"vitest";
const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("competitive creative engine",()=>{
  it("stores proof, claims, intent, specifications, drafts, leads, and observations per tenant",()=>{const sql=read("supabase/migrations/0018_competitive_creative_engine.sql");for(const table of["business_proof_assets","business_claims","serp_intent_snapshots","seo_creative_specs","seo_creative_drafts","seo_leads","seo_experiment_observations"])expect(sql).toContain(`public.${table}`);expect(sql).toContain("has_client_access");expect(sql).toContain("business-proof");});
  it("requires verified proof and blocks restricted claims",()=>{const service=read("lib/creatives/service.ts");expect(service).toContain("CREATIVE_EVIDENCE_REQUIRED");expect(service).toContain("verification_status\",\"verified");expect(service).toContain("pricing_factor");expect(service).toContain("Restricted factual language requires an explicitly approved claim");expect(service).toContain("unauthorizedSectionEvidence");});
  it("lets low-risk metadata alignment prepare itself without weakening full-content proof gates",()=>{const service=read("lib/creatives/service.ts");expect(service).toContain('metadataOnly=opportunity.action_type==="IMPROVE"');expect(service).toContain('mode:"metadata_only"');expect(service).toContain('if(!metadataOnly&&usableProof.length<2)');expect(service).toContain('model:"hdseo-metadata-v1"');expect(service).toContain("No new factual business claims");});
  it("uses strict structured output and does not store provider prompts",()=>{const provider=read("lib/creatives/openai.ts");expect(provider).toContain('type:\"json_schema\"');expect(provider).toContain("strict:true");expect(provider).toContain("store:false");expect(provider).toContain("evidenceIds");expect(provider).toContain("Never invent");});
  it("exposes Creative Studio through the agency navigation",()=>{expect(read("app/ui/live-agency-dashboard.tsx")).toContain('"Creative Studio"');expect(read("app/ui/creative-studio.tsx")).toContain("Business Proof Engine".toUpperCase());});
});
