import { describe,expect,it } from "vitest";

import { evaluateImplementationPage } from "../lib/manual/live-verification-evaluator";
import type { CrawledPage } from "../lib/crawler/site-crawler";

const page:CrawledPage={url:"https://example.com/roof-repair",finalUrl:"https://example.com/roof-repair",httpStatus:200,title:"Roof Repair Jacksonville",metaDescription:"Verified roof repair service details.",h1:"Roof Repair Jacksonville",headings:["Roof Repair Jacksonville"],canonical:"https://example.com/roof-repair",robotsDirectives:[],schemaTypes:["Service"],schemaBlockCount:1,schemaJsonLdValid:true,internalLinks:["https://example.com/contact"],sitemapMember:true,indexable:true,contentHash:"abc123",responseBytes:1000,depth:0};
const packageData={targetUrl:"https://example.com/roof-repair",metadata:{title:"Roof Repair Jacksonville",metaDescription:"Verified roof repair service details.",h1:"Roof Repair Jacksonville"},schema:{types:["Service"]}};

describe("automated implementation verification",()=>{
  it("passes only when live evidence matches the approved package",()=>{const result=evaluateImplementationPage(page,packageData);expect(result.passed).toBe(true);expect(result.failed).toEqual([]);expect(result.page.contentHash).toBe("abc123");});
  it("fails changed metadata, noindex, missing links, and planned schema",()=>{const result=evaluateImplementationPage({...page,title:"Unapproved title",robotsDirectives:["noindex"],indexable:false,internalLinks:[],schemaTypes:[]},packageData);expect(result.passed).toBe(false);expect(result.failed).toEqual(expect.arrayContaining(["metadataCorrect","schemaValid","internalLinksPresent","indexingReady"]));});
  it("does not trust optional schema when none was approved",()=>{const result=evaluateImplementationPage({...page,schemaTypes:[],schemaBlockCount:0}, {...packageData,schema:{types:[]}});expect(result.checks.schemaValid.required).toBe(false);expect(result.passed).toBe(true);});
});
