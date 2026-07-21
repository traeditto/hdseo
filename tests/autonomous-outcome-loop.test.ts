import {describe,expect,it} from "vitest";
import {estimatedCtrForPosition,valueOpportunity} from "../lib/seo/opportunity-value";
import {recommendOutcomeAction} from "../lib/seo/outcome-recommendation";
import {createNextPage,pageSlug,proposeMetadataChange} from "../lib/execution/change-generator";

describe("autonomous outcome loop",()=>{
  it("uses measured business economics without allowing weak economics to dominate",()=>{
    const high=valueOpportunity({seoScore:82,confidenceScore:85,searchVolume:1200,currentRank:8,targetMilestone:"Top 3",actionType:"IMPROVE",economics:{leadConversionRate:.08,qualifiedLeadRate:.8,closeRate:.35,grossProfitPerSale:2400,implementationCost:600}});
    const unknown=valueOpportunity({seoScore:82,confidenceScore:85,searchVolume:1200,currentRank:8,targetMilestone:"Top 3",actionType:"IMPROVE",economics:{}});
    expect(high.businessValue.expectedMonthlyProfit).toBeGreaterThan(unknown.businessValue.expectedMonthlyProfit);
    expect(high.economicsConfidence).toBe(1);
    expect(unknown.economicsConfidence).toBe(0);
    expect(unknown.combinedScore).toBeGreaterThan(60);
  });
  it("uses a conservative rank-to-CTR curve",()=>{expect(estimatedCtrForPosition(1)).toBeGreaterThan(estimatedCtrForPosition(8));expect(estimatedCtrForPosition(null)).toBeLessThan(.01)});
  it("recommends keep, improve, or rollback review from observed outcomes",()=>{
    expect(recommendOutcomeAction({checkpointDay:30,rankDecision:"MILESTONE_REACHED",baseline:{grossProfit:1000,qualifiedLeads:4},observed:{grossProfit:1400,qualifiedLeads:5}}).recommendation).toBe("KEEP");
    expect(recommendOutcomeAction({checkpointDay:60,rankDecision:"REVIEW_REQUIRED",baseline:{grossProfit:1000,qualifiedLeads:4},observed:{grossProfit:900,qualifiedLeads:4}}).recommendation).toBe("IMPROVE");
    expect(recommendOutcomeAction({checkpointDay:60,rankDecision:"DECLINED",baseline:{grossProfit:1000,qualifiedLeads:10},observed:{grossProfit:400,qualifiedLeads:4}}).recommendation).toBe("ROLLBACK_RECOMMENDED");
  });
  it("turns approved creative into an exact, escaped repository change",()=>{
    const creative={title:'Roof Repair "Jacksonville"',meta_description:"Evidence-backed roof repair guidance.",h1:"Roof repair in Jacksonville",summary:"Choose the next step using verified business information.",sections:[{heading:"What to check",body:"Inspect the source of the leak before selecting a repair."}],faqs:[{question:"When should I call?",answer:"Call when active leaking or safety risk is present."}],schema_markup:{"@context":"https://schema.org","@type":"Service"}};
    const page=createNextPage({root:"src/app",slug:pageSlug("https://example.com/roof-repair","roof repair"),creative});
    expect(page.filePath).toBe("src/app/roof-repair/page.tsx");expect(page.proposedContent).toContain("application/ld+json");expect(page.proposedContent).toContain('Roof Repair \\"Jacksonville\\"');
    const edit=proposeMetadataChange({path:"app/page.tsx",sha:"abc",content:'export const metadata = { title: "Old title", description: "Old description" };'},"roof repair",creative);
    expect(edit?.proposedContent).toContain("Evidence-backed roof repair guidance.");
  });
  it("refuses unrelated application routes and targets slug-specific SEO records",()=>{
    const creative={title:"Roofing Company in Jacksonville, FL",meta_description:"Trusted residential roofing for Jacksonville homeowners.",h1:"Jacksonville Roofing Company",summary:"Local roofing help.",sections:[],faqs:[],schema_markup:{}};
    expect(proposeMetadataChange({path:"app/api/seo/campaigns/route.ts",sha:"api",content:'const event={title: "Campaign created"};'},"roofing companies in jax fl",creative,"roofing")).toBeNull();
    const edit=proposeMetadataChange({path:"lib/site-data.ts",sha:"data",content:'export const seo={\n roofing: { seoTitle: "Residential Roofing", primaryKeyword: "residential roofing", canonicalPath: "/roofing" },\n};'},"roofing companies in jax fl",creative,"roofing");
    expect(edit?.filePath).toBe("lib/site-data.ts");
    expect(edit?.proposedContent).toContain('seoTitle: "Roofing Company in Jacksonville, FL"');
    expect(edit?.proposedContent).toContain('primaryKeyword: "roofing companies in jax fl"');
  });
});
