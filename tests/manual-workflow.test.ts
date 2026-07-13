import { describe,expect,it } from "vitest";
import { selectImplementationPath } from "../lib/seo/implementation-path";
import { buildManualPackage } from "../lib/seo/manual-package";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("manual implementation workflow",()=>{
  it("keeps repository execution behind every readiness gate",()=>{
    expect(selectImplementationPath({repositoryRequested:true,repositoryReady:false,cmsType:"wordpress",actionType:"IMPROVE"}).path).toBe("wordpress_package");
    expect(selectImplementationPath({repositoryRequested:true,repositoryReady:true,cmsType:"wordpress",actionType:"IMPROVE"}).path).toBe("repository");
  });

  it("selects WordPress, generic CMS, and developer tickets deterministically",()=>{
    expect(selectImplementationPath({cmsType:"wordpress",actionType:"CONTENT"}).path).toBe("wordpress_package");
    expect(selectImplementationPath({cmsType:"webflow",actionType:"CONTENT"}).path).toBe("generic_cms");
    expect(selectImplementationPath({cmsType:"custom",actionType:"TECHNICAL"}).path).toBe("developer_ticket");
  });

  it("builds Gutenberg and SEO-plugin fields without inventing business claims",()=>{
    const result=buildManualPackage({path:"wordpress_package",cmsMode:"gutenberg",keyword:"roof repair jacksonville",targetUrl:"https://example.com/roof-repair",actionType:"IMPROVE",verifiedEvidence:[{type:"license",title:"License",wording:"State license ABC-123"}],missingEvidence:["warranty"]});
    expect(result.format).toBe("wordpress");
    if(result.format!=="wordpress")throw new Error("Expected a WordPress package");
    expect(result.gutenbergBlocks.length).toBeGreaterThan(0);
    expect(result.seoPluginFields.yoast.focusKeyphrase).toBe("roof repair jacksonville");
    expect(result.seoPluginFields.rankMath.focusKeyword).toBe("roof repair jacksonville");
    expect(result.verifiedFacts).toEqual([{type:"license",label:"License",approvedWording:"State license ABC-123"}]);
    expect(JSON.stringify(result)).not.toContain("best roofing company");
  });

  it("schedules the complete manual monitoring cadence only after passed verification",()=>{
    const sql=readFileSync(join(process.cwd(),"supabase/migrations/0011_manual_monitoring_extensions.sql"),"utf8");
    expect(sql).toContain("status='passed'");
    expect(sql).toContain("array[7,14,30,60,90]");
    expect(sql).toContain("manual_workflow_verified_at");
  });
});
