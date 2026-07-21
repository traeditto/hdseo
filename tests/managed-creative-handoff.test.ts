import{readFileSync}from"node:fs";
import{join}from"node:path";
import{describe,expect,it}from"vitest";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("managed campaign creative handoff",()=>{
  it("routes approved BUILD and CONTENT repository work through proof-gated Creative Studio",()=>{
    const route=read("app/api/jobs/[jobId]/review-opportunity/route.ts");
    expect(route).toContain('opportunity.data.action_type==="BUILD"||opportunity.data.action_type==="CONTENT"');
    expect(route).toContain("prepareCampaignCreativeHandoff");
    expect(route).toContain('"awaiting_creative_evidence"');
    expect(route).toContain('"awaiting_creative_review"');
    expect(route).toContain("creativeDraftId");
  });

  it("reuses existing drafts and resumes only the matching tenant campaign after approval",()=>{
    const service=read("lib/creatives/service.ts");
    expect(service).toContain("must not create duplicate model spend");
    expect(service).toContain("The creative generation lock could not be acquired.");
    expect(service).toContain('existing.data?.status==="approved"');
    expect(service).toContain('.contains("result",{creativeDraftId:draftId})');
    expect(service).toContain('current_stage:"inspect_repository"');
    expect(service).toContain("resumedCampaignIds");
  });

  it("refreshes evidence-needed specs and safely advances proof-blocked campaigns",()=>{
    const service=read("lib/creatives/service.ts");
    expect(service).toContain('existing.data&&existing.data.status!=="evidence_needed"');
    expect(service).toContain('proof_asset_ids:proof.map((row:any)=>row.id),status:ready?"ready":"evidence_needed"');
    expect(service).toContain("refreshEvidenceNeededCreativeSpecs");
    expect(service).toContain("refreshedSpecIds");
    expect(service).toContain("resumeEvidenceWaitingCreativeCampaigns");
    expect(service).toContain('.eq("status","awaiting_creative_evidence")');
    expect(service).toContain('ready?"inspect_repository":"prepare"');
    expect(service).toContain('creative.state==="evidence_required"?"awaiting_creative_evidence":"awaiting_creative_review"');
  });
});
