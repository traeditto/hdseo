import type { CrawledPage } from "@/lib/crawler/site-crawler";

type PackageData={targetUrl?:unknown;metadata?:{title?:unknown;metaDescription?:unknown;h1?:unknown};schema?:{types?:unknown}};
export type AutomatedImplementationCheck={passed:boolean;required:boolean;expected?:unknown;actual?:unknown};
const text=(value:unknown)=>typeof value==="string"?value.replace(/\s+/g," ").trim():null;
const sameText=(actual:unknown,expected:unknown)=>Boolean(text(actual)&&text(expected)&&text(actual)===text(expected));
const comparableUrl=(value:unknown)=>{try{const url=new URL(String(value));url.hash="";url.search="";return url.toString().replace(/\/$/,"");}catch{return null;}};

export function evaluateImplementationPage(page:CrawledPage,rawPackageData:unknown){
  const packageData=(rawPackageData&&typeof rawPackageData==="object"?rawPackageData:{}) as PackageData,expectedTitle=text(packageData.metadata?.title),expectedDescription=text(packageData.metadata?.metaDescription),expectedH1=text(packageData.metadata?.h1),expectedCanonical=comparableUrl(packageData.targetUrl),expectedSchema=Array.isArray(packageData.schema?.types)?packageData.schema.types.filter((item):item is string=>typeof item==="string"):[];
  const checks:Record<string,AutomatedImplementationCheck>={
    pageResolves:{passed:page.httpStatus>=200&&page.httpStatus<300,required:true,expected:"HTTP 2xx",actual:page.httpStatus},contentPresent:{passed:Boolean(page.title&&page.h1),required:true,expected:"A rendered title and H1",actual:{title:page.title,h1:page.h1}},metadataCorrect:{passed:(!expectedTitle||sameText(page.title,expectedTitle))&&(!expectedDescription||sameText(page.metaDescription,expectedDescription)),required:true,expected:{title:expectedTitle,metaDescription:expectedDescription},actual:{title:page.title,metaDescription:page.metaDescription}},h1Correct:{passed:!expectedH1||sameText(page.h1,expectedH1),required:true,expected:expectedH1,actual:page.h1},canonicalCorrect:{passed:!expectedCanonical||comparableUrl(page.canonical)===expectedCanonical,required:true,expected:expectedCanonical,actual:comparableUrl(page.canonical)},schemaValid:{passed:page.schemaJsonLdValid&&(!expectedSchema.length||expectedSchema.every(type=>page.schemaTypes.includes(type))),required:Boolean(expectedSchema.length),expected:expectedSchema,actual:{blocks:page.schemaBlockCount,types:page.schemaTypes,jsonLdValid:page.schemaJsonLdValid}},internalLinksPresent:{passed:page.internalLinks.length>0,required:true,expected:"At least one contextual internal link",actual:page.internalLinks.slice(0,20)},indexingReady:{passed:page.indexable&&!page.robotsDirectives.some(item=>item.includes("noindex")),required:true,expected:"Publicly indexable",actual:{indexable:page.indexable,robotsDirectives:page.robotsDirectives}},
  };
  const failed=Object.entries(checks).filter(([,check])=>check.required&&!check.passed).map(([key])=>key);
  return{passed:failed.length===0,failed,checks,page:{url:page.url,finalUrl:page.finalUrl,httpStatus:page.httpStatus,contentHash:page.contentHash}};
}
